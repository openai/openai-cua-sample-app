import base64
from e2b_desktop import Sandbox

class E2BDesktop:
    """
    E2B Desktop is an open-source desktop environment for AI Agents.
    You can get started for free at https://e2b.dev or read our docs at https://docs.e2b.dev
    """

    def __init__(self):
        self.environment = "linux"  # "windows", "mac", "linux", or "browser"
        self.dimensions = (1024, 768)

    def __enter__(self):
        print("Starting E2B Desktop Sandbox")
        self.sandbox = Sandbox(
            resolution=self.dimensions,
            timeout=300,
        )

        print(f"Started E2B Desktop Sandbox with id '{self.sandbox.sandbox_id}'")

        print("Starting Desktop Stream")
        self.sandbox.stream.start(require_auth=True)

        stream_url = self.sandbox.stream.get_url(auth_key=self.sandbox.stream.get_auth_key())
        print(f"Desktop Stream is running at {stream_url}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.sandbox.kill()

    def screenshot(self) -> str:
        screenshot = self.sandbox.screenshot()
        base64_image = base64.b64encode(screenshot).decode("utf-8")
        return base64_image

    def click(self, x: int, y: int, button: str = "left") -> None:
        match button:
            case "left":
                self.sandbox.move_mouse(x, y)
                self.sandbox.left_click()
            case "right":
                self.sandbox.move_mouse(x, y)
                self.sandbox.right_click()
            case "middle":
                self.sandbox.move_mouse(x, y)
                self.sandbox.middle_click()

    def double_click(self, x: int, y: int) -> None:
        self.sandbox.move_mouse(x, y)
        self.sandbox.double_click()

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        self.sandbox.move_mouse(x, y)
        self.sandbox.scroll(scroll_x, scroll_y)

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
