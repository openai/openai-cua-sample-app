import base64
from e2b_desktop import Sandbox
from typing import Literal

class E2BDesktop:
    """
    E2B Desktop is an open-source desktop environment for AI Agents.
    You can get started for free at https://e2b.dev or read our docs at https://docs.e2b.dev
    """

    def __init__(self):
        self.environment: Literal["windows", "mac", "linux", "browser"] = "linux"  # "windows", "mac", "linux", or "browser"
        self.dimensions = (1024, 768)
        self.stream_url: str | None = None

    def __enter__(self):
        print("Starting E2B Desktop Sandbox")
        self.sandbox = Sandbox(
            resolution=self.dimensions,
            timeout=300,
        )

        print(f"Started E2B Desktop Sandbox with id '{self.sandbox.sandbox_id}'")

        self.sandbox.stream.start(require_auth=True)

        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.sandbox.kill()

    def screenshot(self) -> str:
        screenshot = self.sandbox.screenshot(format="bytes")
        base64_image = base64.b64encode(screenshot).decode("utf-8")
        return base64_image

    def click(self, x: int, y: int, button: str = "left") -> None:
        match button:
            case "left":
                self.sandbox.left_click(x, y)
            case "right":
                self.sandbox.right_click(x, y)
            case "middle":
                self.sandbox.middle_click(x, y)

    def double_click(self, x: int, y: int) -> None:
        self.sandbox.double_click(x, y)

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        self.sandbox.move_mouse(x, y)
        if scroll_y < 0:
            self.sandbox.scroll("up", abs(scroll_y))
        elif scroll_y > 0:
            self.sandbox.scroll("down", scroll_y)

    def type(self, text: str) -> None:
        self.sandbox.write(text)

    def wait(self, ms: int = 1000) -> None:
        self.sandbox.wait(ms)

    def move(self, x: int, y: int) -> None:
        self.sandbox.move_mouse(x, y)

    def keypress(self, keys: list[str]) -> None:
        self.sandbox.press(keys)

    def drag(self, path: list[dict[str, int]]) -> None:
        if not path:
            return
        start_x = path[0]["x"]
        start_y = path[0]["y"]

        end_x = path[-1]["x"]
        end_y = path[-1]["y"]

        self.sandbox.drag((start_x, start_y), (end_x, end_y))

    def get_environment(self) -> Literal["windows", "mac", "linux", "browser"]:
        return self.environment

    def get_dimensions(self) -> tuple[int, int]:
        return self.dimensions

    def get_current_url(self) -> str:
        return self.sandbox.stream.get_url(auth_key=self.sandbox.stream.get_auth_key())