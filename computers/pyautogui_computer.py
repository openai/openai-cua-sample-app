import time
import base64
import platform
import io
from typing import List, Dict, Literal
import pyautogui
from PIL import Image

# Key mapping for CUA style keys to PyAutoGUI keys
CUA_KEY_TO_PYAUTOGUI_KEY = {
    "/": "/",
    "\\": "\\",
    "alt": "alt",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "arrowup": "up",
    "backspace": "backspace",
    "capslock": "capslock",
    "cmd": "command",
    "ctrl": "ctrl",
    "delete": "delete",
    "end": "end",
    "enter": "enter",
    "esc": "escape",
    "home": "home",
    "insert": "insert",
    "option": "option",
    "pagedown": "pagedown",
    "pageup": "pageup",
    "shift": "shift",
    "space": "space",
    "super": "win",
    "tab": "tab",
    "win": "win",
}


class PyAutoGUIComputer:
    """
    Computer implementation using PyAutoGUI to control the local desktop environment.
    Follows the Computer protocol to provide consistent interface for the agent.
    """

    def __init__(self):
        # Set the default behavior of PyAutoGUI
        pyautogui.PAUSE = 0.1  # Add a small pause between PyAutoGUI commands
        pyautogui.FAILSAFE = True  # Move mouse to upper-left corner to abort

        # Store the screen size
        self._screen_width, self._screen_height = pyautogui.size()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Cleanup if needed
        pass

    @property
    def environment(self) -> Literal["windows", "mac", "linux"]:
        """Return the operating system environment."""
        system = platform.system().lower()
        if system == "darwin":
            return "mac"
        elif system == "windows":
            return "windows"
        else:
            return "linux"

    @property
    def dimensions(self) -> tuple[int, int]:
        """Return the screen dimensions."""
        return (self._screen_width, self._screen_height)

    def screenshot(self) -> str:
        """Take a screenshot and return as base64 encoded string."""
        screenshot = pyautogui.screenshot()
        
        # Convert PIL Image to base64
        buffered = io.BytesIO()
        screenshot.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    def click(self, x: int, y: int, button: str = "left") -> None:
        """Click at the specified coordinates with the specified button."""
        # Map button names if needed
        button_mapping = {"left": "left", "right": "right", "middle": "middle"}
        button_type = button_mapping.get(button, "left")
        
        pyautogui.click(x=x, y=y, button=button_type)

    def double_click(self, x: int, y: int) -> None:
        """Double-click at the specified coordinates."""
        pyautogui.doubleClick(x=x, y=y)

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        """Scroll at the specified coordinates."""
        # Move to position first
        pyautogui.moveTo(x, y)
        
        # PyAutoGUI scroll works differently, normalized to fit the interface
        # Positive values scroll down, negative values scroll up
        pyautogui.scroll(clicks=-scroll_y)  # Invert scroll_y to match expected behavior
        
        # Note: PyAutoGUI doesn't support horizontal scrolling directly
        # Could use pyautogui.hscroll if it becomes available

    def type(self, text: str) -> None:
        """Type the specified text."""
        pyautogui.write(text)

    def wait(self, ms: int = 1000) -> None:
        """Wait for the specified number of milliseconds."""
        time.sleep(ms / 1000)

    def move(self, x: int, y: int) -> None:
        """Move the mouse to the specified coordinates."""
        pyautogui.moveTo(x, y)

    def keypress(self, keys: List[str]) -> None:
        """Press the specified keys."""
        # Map keys to PyAutoGUI format
        mapped_keys = [CUA_KEY_TO_PYAUTOGUI_KEY.get(key.lower(), key) for key in keys]
        
        # Press and release keys in sequence
        pyautogui.hotkey(*mapped_keys)

    def drag(self, path: List[Dict[str, int]]) -> None:
        """Drag along the specified path."""
        if not path:
            return
        
        # Move to starting point
        pyautogui.moveTo(path[0]["x"], path[0]["y"])
        
        # Start dragging
        pyautogui.mouseDown()
        
        # Move along path
        for point in path[1:]:
            pyautogui.moveTo(point["x"], point["y"])
        
        # Release mouse
        pyautogui.mouseUp()

    def get_current_url(self) -> str:
        """
        This method is required by the Computer protocol but doesn't make 
        sense for desktop control. Return a placeholder value.
        """
        return "desktop://"