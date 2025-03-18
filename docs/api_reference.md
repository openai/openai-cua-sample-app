# API Reference

This document provides a reference for the key API components in the Computer Using Agent (CUA) Sample App.

## Agent API

### Agent Class

```python
class Agent:
    def __init__(
        self,
        model="computer-use-preview-2025-02-04",
        computer: Computer = None,
        tools: list[dict] = [],
        acknowledge_safety_check_callback: Callable = lambda: False,
    ):
        """
        Initialize an Agent instance.

        Args:
            model (str): The OpenAI model to use
            computer (Computer): The Computer implementation to use
            tools (list[dict]): Additional tools to provide to the model
            acknowledge_safety_check_callback (Callable): Function to call for safety checks
        """
        pass

    def run_full_turn(
        self, input_items, print_steps=True, debug=False, show_images=False
    ):
        """
        Run a full interaction turn with the model.

        Args:
            input_items (list): The current conversation context
            print_steps (bool): Whether to print steps during execution
            debug (bool): Whether to print debug information
            show_images (bool): Whether to show images during execution

        Returns:
            list: The new items added to the conversation context
        """
        pass

    def handle_item(self, item):
        """
        Handle an item from the model's response.

        Args:
            item (dict): The item to handle

        Returns:
            list: Any new items to add to the conversation context
        """
        pass
```

## Computer API

### Computer Protocol

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

### BasePlaywrightComputer

```python
class BasePlaywrightComputer:
    """
    Abstract base for Playwright-based computers.
    
    Attributes:
        environment (Literal["browser"]): The environment type
        dimensions (tuple[int, int]): The dimensions of the screen
    """

    def __enter__(self):
        """
        Set up the Playwright environment.

        Returns:
            self: The computer instance
        """
        pass

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Clean up the Playwright environment.
        """
        pass

    def get_current_url(self) -> str:
        """
        Get the current URL of the page.
        
        Returns:
            str: The current URL
        """
        pass

    def screenshot(self) -> str:
        """
        Capture a screenshot of the current page.
        
        Returns:
            str: The base64-encoded screenshot
        """
        pass

    def click(self, x: int, y: int, button: str = "left") -> None:
        """
        Perform a mouse click at the specified coordinates.
        
        Args:
            x (int): The x-coordinate
            y (int): The y-coordinate
            button (str): The mouse button to use
        """
        pass

    def double_click(self, x: int, y: int) -> None:
        """
        Perform a double-click at the specified coordinates.
        
        Args:
            x (int): The x-coordinate
            y (int): The y-coordinate
        """
        pass

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        """
        Scroll the page at the specified coordinates.
        
        Args:
            x (int): The x-coordinate
            y (int): The y-coordinate
            scroll_x (int): The amount to scroll horizontally
            scroll_y (int): The amount to scroll vertically
        """
        pass

    def type(self, text: str) -> None:
        """
        Type the specified text.
        
        Args:
            text (str): The text to type
        """
        pass

    def wait(self, ms: int = 1000) -> None:
        """
        Wait for the specified number of milliseconds.
        
        Args:
            ms (int): The number of milliseconds to wait
        """
        pass

    def move(self, x: int, y: int) -> None:
        """
        Move the mouse to the specified coordinates.
        
        Args:
            x (int): The x-coordinate
            y (int): The y-coordinate
        """
        pass

    def keypress(self, keys: List[str]) -> None:
        """
        Press the specified keys.
        
        Args:
            keys (List[str]): The keys to press
        """
        pass

    def drag(self, path: List[Dict[str, int]]) -> None:
        """
        Perform a drag operation along the specified path.
        
        Args:
            path (List[Dict[str, int]]): The path to drag along
        """
        pass

    def goto(self, url: str) -> None:
        """
        Navigate to the specified URL.
        
        Args:
            url (str): The URL to navigate to
        """
        pass

    def back(self) -> None:
        """
        Navigate back in the browser history.
        """
        pass

    def forward(self) -> None:
        """
        Navigate forward in the browser history.
        """
        pass

    def _get_browser_and_page(self) -> tuple[Browser, Page]:
        """
        Get a browser instance and page.
        
        Returns:
            tuple[Browser, Page]: The browser and page instances
        """
        raise NotImplementedError
```

## Utility Functions

### create_response()

```python
def create_response(**kwargs):
    """
    Create a response from the OpenAI API.
    
    Args:
        **kwargs: Arguments to pass to the API
        
    Returns:
        dict: The API response
    """
    pass
```

### show_image()

```python
def show_image(base_64_image):
    """
    Display an image from a base64-encoded string.
    
    Args:
        base_64_image (str): The base64-encoded image
    """
    pass
```

### check_blocklisted_url()

```python
def check_blocklisted_url(url: str) -> None:
    """
    Check if a URL is in the blocklist.
    
    Args:
        url (str): The URL to check
        
    Raises:
        ValueError: If the URL is in the blocklist
    """
    pass
```

### sanitize_message()

```python
def sanitize_message(msg: dict) -> dict:
    """
    Sanitize a message by omitting image_url for computer_call_output messages.
    
    Args:
        msg (dict): The message to sanitize
        
    Returns:
        dict: The sanitized message
    """
    pass
```

## CLI Functions

### acknowledge_safety_check_callback()

```python
def acknowledge_safety_check_callback(message: str) -> bool:
    """
    Prompt the user to acknowledge a safety check.
    
    Args:
        message (str): The safety check message
        
    Returns:
        bool: Whether the user acknowledged the check
    """
    pass
```

### main()

```python
def main():
    """
    Run the CLI.
    """
    pass
```

## Simple CUA Loop Functions

### handle_item()

```python
def handle_item(item, computer: Computer):
    """
    Handle an item from the model's response.
    
    Args:
        item (dict): The item to handle
        computer (Computer): The Computer implementation to use
        
    Returns:
        list: Any new items to add to the conversation context
    """
    pass
```

### main()

```python
def main():
    """
    Run the simple CUA loop.
    """
    pass
``` 