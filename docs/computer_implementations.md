# Computer Protocol and Implementations

## Computer Protocol

The `Computer` protocol, defined in `computers/computer.py`, specifies the interface that all computer environment implementations must adhere to. It defines a set of methods for interacting with a computer environment, which could be a local browser, a remote browser, or a desktop environment.

### Core Interface

```python
class Computer(Protocol):
    """Defines the 'shape' (methods/properties) our loop expects."""

    @property
    def environment(self) -> Literal["windows", "mac", "linux", "browser"]: ...
    @property
    def dimensions(self) -> tuple[int, int]: ...

    def screenshot(self) -> str: ...

    def click(self, x: int, y: int, button: str = "left") -> None: ...

    def double_click(self, x: int, y: int) -> None: ...

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None: ...

    def type(self, text: str) -> None: ...

    def wait(self, ms: int = 1000) -> None: ...

    def move(self, x: int, y: int) -> None: ...

    def keypress(self, keys: List[str]) -> None: ...

    def drag(self, path: List[Dict[str, int]]) -> None: ...

    def get_current_url() -> str: ...
```

### Required Methods

| Method | Description | Parameters |
|--------|-------------|------------|
| `screenshot()` | Captures and returns a base64-encoded image of the current screen | None |
| `click()` | Performs a mouse click at the specified coordinates | `x`, `y`, `button` |
| `double_click()` | Performs a double-click at the specified coordinates | `x`, `y` |
| `scroll()` | Scrolls the screen at the specified coordinates | `x`, `y`, `scroll_x`, `scroll_y` |
| `type()` | Types the specified text | `text` |
| `wait()` | Waits for the specified number of milliseconds | `ms` |
| `move()` | Moves the mouse to the specified coordinates | `x`, `y` |
| `keypress()` | Presses the specified keys | `keys` |
| `drag()` | Performs a drag operation along the specified path | `path` |
| `get_current_url()` | Returns the current URL (for browser environments) | None |

### Required Properties

| Property | Description | Type |
|----------|-------------|------|
| `environment` | Specifies the type of environment ("windows", "mac", "linux", "browser") | `Literal["windows", "mac", "linux", "browser"]` |
| `dimensions` | The dimensions of the screen (width, height) | `tuple[int, int]` |

## Computer Implementations

The repository includes several computer implementations, each designed to work with a different environment.

### BasePlaywrightComputer

The `BasePlaywrightComputer` class, defined in `computers/base_playwright.py`, serves as an abstract base class for Playwright-based computer implementations. It implements all the required methods of the `Computer` protocol, but leaves the actual browser/page connection to be implemented by subclasses.

Key features:

- Context management with `__enter__` and `__exit__` methods
- Network interception for security (blocking requests to suspicious domains)
- Implementation of all standard Computer actions
- Extra browser-specific actions like `goto()`, `back()`, and `forward()`

### LocalPlaywrightComputer

The `LocalPlaywrightComputer` class, defined in `computers/local_playwright.py`, extends `BasePlaywrightComputer` to use a local Chromium instance via Playwright.

```python
class LocalPlaywrightComputer(BasePlaywrightComputer):
    """Launches a local Chromium instance using Playwright."""

    def __init__(self, headless: bool = False):
        super().__init__()
        self.headless = headless

    def _get_browser_and_page(self) -> tuple[Browser, Page]:
        width, height = self.dimensions
        launch_args = [
            f"--window-size={width},{height}", 
            "--disable-extensions", 
            "--disable-file-system"
        ]
        browser = self._playwright.chromium.launch(
            chromium_sandbox=True,
            headless=self.headless,
            args=launch_args,
            env={}
        )
        page = browser.new_page()
        page.set_viewport_size({"width": width, "height": height})
        page.goto("https://bing.com")
        return browser, page
```

### DockerComputer

The `DockerComputer` class connects to a Docker container running a VNC server, providing a Linux desktop environment.

Key features:
- Connects to a VNC server running in Docker
- Uses PyVNC for VNC interaction
- Implements all standard Computer actions in a Linux desktop context

### BrowserbaseBrowser

The `BrowserbaseBrowser` class connects to the Browserbase API, a service that provides remote browser environments.

Key features:
- Creates and connects to a remote browser session
- Uses the Browserbase API for interaction
- Requires a Browserbase API key

### ScrapybaraBrowser

The `ScrapybaraBrowser` class connects to the Scrapybara API, which provides remote browser environments.

Key features:
- Creates and connects to a remote browser session
- Uses the Scrapybara API for interaction
- Requires a Scrapybara API key

### ScrapybaraUbuntu

The `ScrapybaraUbuntu` class connects to the Scrapybara API, but uses a remote Ubuntu desktop environment instead of a browser.

Key features:
- Creates and connects to a remote Ubuntu desktop session
- Uses the Scrapybara API for interaction
- Requires a Scrapybara API key

## Extending with Custom Computer Implementations

You can create your own Computer implementation by:

1. Implementing the `Computer` protocol
2. Adding your implementation to the `computers/__init__.py` file
3. Registering it in the `computer_mapping` dictionary in `cli.py`

Example skeleton for a custom implementation:

```python
class MyCustomComputer:
    """My custom computer implementation."""

    environment = "browser"  # or "windows", "mac", "linux"
    dimensions = (1024, 768)  # default dimensions

    def __init__(self):
        # Initialize your environment connection
        pass

    def __enter__(self):
        # Set up your environment
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Clean up your environment
        pass

    def screenshot(self) -> str:
        # Capture and return a base64-encoded screenshot
        pass

    # Implement all other required methods...
``` 