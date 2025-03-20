import time
import base64
from typing import List, Dict, Literal

class MacOSComputer:
    environment: Literal["mac"] = "mac"

    def __init__(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    # --- Common "Computer" actions ---
    def screenshot(self) -> str:
        """Capture only the viewport (not full_page)."""
        png_bytes = self._page.screenshot(full_page=False)
        return base64.b64encode(png_bytes).decode("utf-8")

    def click(self, x: int, y: int, button: str = "left") -> None:
        match button:
            case "back":
                self.back()
            case "forward":
                self.forward()
            case "wheel":
                self._page.mouse.wheel(x, y)
            case _:
                button_mapping = {"left": "left", "right": "right"}
                button_type = button_mapping.get(button, "left")
                self._page.mouse.click(x, y, button=button_type)

    def double_click(self, x: int, y: int) -> None:
        self._page.mouse.dblclick(x, y)

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        self._page.mouse.move(x, y)
        self._page.evaluate(f"window.scrollBy({scroll_x}, {scroll_y})")

    def type(self, text: str) -> None:
        self._page.keyboard.type(text)

    def wait(self, ms: int = 1000) -> None:
        time.sleep(ms / 1000)

    def move(self, x: int, y: int) -> None:
        self._page.mouse.move(x, y)

    def keypress(self, keys: List[str]) -> None:
        mapped_keys = [CUA_KEY_TO_PLAYWRIGHT_KEY.get(key.lower(), key) for key in keys]
        for key in mapped_keys:
            self._page.keyboard.down(key)
        for key in reversed(mapped_keys):
            self._page.keyboard.up(key)

    def drag(self, path: List[Dict[str, int]]) -> None:
        if not path:
            return
        self._page.mouse.move(path[0]["x"], path[0]["y"])
        self._page.mouse.down()
        for point in path[1:]:
            self._page.mouse.move(point["x"], point["y"])
        self._page.mouse.up()

    # --- Extra browser-oriented actions ---
    def goto(self, url: str) -> None:
        try:
            return self._page.goto(url)
        except Exception as e:
            print(f"Error navigating to {url}: {e}")

    def back(self) -> None:
        return self._page.go_back()

    def forward(self) -> None:
        return self._page.go_forward()

    # --- Subclass hook ---
    def _get_browser_and_page(self) -> tuple[Browser, Page]:
        """Subclasses must implement, returning (Browser, Page)."""
        raise NotImplementedError
