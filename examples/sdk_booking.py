# /// script
# requires-python = ">=3.10"
# dependencies = ["openai==3.31.0", "playwright==1.58.0"]
# ///
"""Run the SDK computer-use helper against this repository's booking lab."""

import argparse
import base64
import json
import threading
import time
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openai import ComputerDriver, ComputerToolset, OpenAI
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY_NAMES = {
    "CTRL": "Control", "CONTROL": "Control", "CMD": "Meta", "COMMAND": "Meta",
    "META": "Meta", "ALT": "Alt", "OPTION": "Alt", "SHIFT": "Shift",
    "ENTER": "Enter", "RETURN": "Enter", "ESC": "Escape", "ESCAPE": "Escape",
    "TAB": "Tab", "SPACE": "Space", "BACKSPACE": "Backspace", "DELETE": "Delete",
    "UP": "ArrowUp", "DOWN": "ArrowDown", "LEFT": "ArrowLeft", "RIGHT": "ArrowRight",
}


class BookingBrowser(ComputerDriver):
    """Coordinates refer to the page viewport, not the physical desktop."""

    def __init__(self, page: Page):
        self.page = page

    @contextmanager
    def held_keys(self, action):
        held = []
        try:
            for key in getattr(action, "keys", None) or []:
                name = KEY_NAMES.get(key.upper(), key)
                self.page.keyboard.down(name)
                held.append(name)
            yield
        finally:
            for name in reversed(held):
                self.page.keyboard.up(name)

    def click(self, action):
        button = {"left": "left", "right": "right", "wheel": "middle"}.get(action.button)
        if button is None:
            raise ValueError(f"Unsupported browser mouse button: {action.button}")
        with self.held_keys(action):
            self.page.mouse.click(action.x, action.y, button=button)

    def double_click(self, action):
        with self.held_keys(action):
            self.page.mouse.dblclick(action.x, action.y)

    def drag(self, action):
        with self.held_keys(action):
            start, *rest = action.path
            self.page.mouse.move(start.x, start.y)
            self.page.mouse.down()
            try:
                for point in rest:
                    self.page.mouse.move(point.x, point.y, steps=3)
            finally:
                self.page.mouse.up()

    def keypress(self, action):
        with self.held_keys(action):
            pass

    def move(self, action):
        with self.held_keys(action):
            self.page.mouse.move(action.x, action.y)

    def scroll(self, action):
        with self.held_keys(action):
            self.page.mouse.move(action.x, action.y)
            self.page.mouse.wheel(action.scroll_x, action.scroll_y)

    def type(self, action):
        self.page.keyboard.insert_text(action.text)

    def wait(self, action):
        time.sleep(0.5)

    def screenshot(self):
        encoded = base64.b64encode(self.page.screenshot(type="png", scale="css")).decode("ascii")
        return {"type": "computer_screenshot", "image_url": f"data:image/png;base64,{encoded}"}


@contextmanager
def booking_page():
    handler = partial(
        SimpleHTTPRequestHandler, directory=str(ROOT / "labs" / "booking-lab-template")
    )
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True, timeout=15_000)
                context = browser.new_context(
                    viewport={"width": 1280, "height": 900}, device_scale_factor=1,
                    service_workers="block",
                )
                # This example only operates the local fake booking lab.
                context.route(
                    "**/*",
                    lambda route: route.continue_()
                    if route.request.url.startswith(origin + "/")
                    else route.abort(),
                )
                page = context.new_page()
                page.goto(origin, wait_until="networkidle")
                try:
                    yield page
                finally:
                    context.close()
                    browser.close()
        finally:
            server.shutdown()
            thread.join()


def run(client: OpenAI, prompt: str, model: str):
    with booking_page() as page:
        toolset = ComputerToolset(BookingBrowser(page))
        try:
            response = toolset.run(
                client,
                {
                    "model": model,
                    "input": prompt,
                    "instructions": (
                        "Use the computer to complete the requested task on this fictional booking site. "
                        "Request a screenshot to inspect the page before acting."
                    ),
                    "store": False,
                },
                max_steps=20,
            )
            print(response.output_text)
            print("Booking status:", page.get_by_test_id("booking-status").inner_text())
            print("Hotel:", page.get_by_test_id("confirmation-hotel").inner_text())
            print("Guest:", page.get_by_test_id("confirmation-guest").inner_text())
            print("Dates:", page.get_by_test_id("confirmation-dates").inner_text())
            print("Request:", page.get_by_test_id("confirmation-request").inner_text())
        finally:
            toolset.close()


def main():
    catalog = json.loads((ROOT / "labs" / "catalog.json").read_text())
    booking = next(s for s in catalog["scenarios"] if s["labId"] == "booking")
    defaults = json.loads((ROOT / "contracts" / "defaults.json").read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=booking["defaultPrompt"])
    parser.add_argument("--model", default=defaults["model"])
    args = parser.parse_args()
    with OpenAI() as client:
        run(client, args.prompt, args.model)


if __name__ == "__main__":
    main()
