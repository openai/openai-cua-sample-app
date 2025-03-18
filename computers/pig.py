import time
from dotenv import load_dotenv
import os
import base64

from pig import Client

load_dotenv()

class PigWindows:
    """
    Pig helps you securely control your Windows machines across the internet.
    You can connect your own computer for free at https://docs.pig.dev/quickstart/intro 
    """

    def __init__(self):
        self.machine_id = os.getenv("PIG_MACHINE_ID")
        if not self.machine_id:
            raise ValueError("PIG_MACHINE_ID environment variable is not set. Connect your machine as a worker at https://docs.pig.dev/quickstart/intro and get its machine ID from the dashboard https://pig.dev/app")
        
        self.client = Client()
        self.environment = "windows"

        # We have the model operate on virtual dimensions and scale accordingly to match target machine
        self.dimensions = (1024, 768)
        self.screen_w, self.screen_h = None, None

        # __enter__ will call into Pig's API to establish a client connection
        self.machine = None
        self.connection = None

    def __enter__(self):
        print("Connecting to your Windows machine...")
        self.machine = self.client.machines.get(self.machine_id)
        self.connection = self.client.connections.create(self.machine)
        physical_dims = self.connection.dimensions()
        
        # Set screen dimensions for coordinate scaling
        self.screen_w, self.screen_h = physical_dims
        print(f"Windows machine connected with physical screen dimensions: {physical_dims}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def to_screen_coordinates(self, model_x, model_y):
        """Convert model coordinates (1024x768) to actual screen coordinates."""
        if model_x is None or model_y is None:
            return None, None
            
        screen_x = int(model_x * self.screen_w / self.dimensions[0])
        screen_y = int(model_y * self.screen_h / self.dimensions[1])
        
        # Clamp to screen bounds
        screen_x = max(0, min(screen_x, self.screen_w - 1))
        screen_y = max(0, min(screen_y, self.screen_h - 1))
        
        return screen_x, screen_y
    
    def to_model_coordinates(self, screen_x, screen_y):
        """Convert actual screen coordinates to model coordinates (1024x768)."""
        if screen_x is None or screen_y is None:
            return None, None
            
        model_x = int(screen_x * self.dimensions[0] / self.screen_w)
        model_y = int(screen_y * self.dimensions[1] / self.screen_h)
        
        # Clamp to model bounds
        model_x = max(0, min(model_x, self.dimensions[0] - 1))
        model_y = max(0, min(model_y, self.dimensions[1] - 1))
        
        return model_x, model_y

    def screenshot(self) -> str:
        """Capture a screenshot and return it as a base64 encoded string."""
        screenshot_bytes = self.connection.screenshot()
        return base64.b64encode(screenshot_bytes).decode()

    def click(self, x: int, y: int, button: str = "left") -> None:
        """Click at the specified coordinates with the specified button."""
        screen_x, screen_y = self.to_screen_coordinates(x, y)
        
        if button == "left":
            self.connection.left_click(screen_x, screen_y)
        elif button == "right":
            self.connection.right_click(screen_x, screen_y)
        elif button == "wheel" or button == "middle":
            # Wheel unsupported
            pass

    def double_click(self, x: int, y: int) -> None:
        """Double click at the specified coordinates."""
        screen_x, screen_y = self.to_screen_coordinates(x, y)
        self.connection.double_click(screen_x, screen_y)

    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        """Scroll at the specified coordinates with the specified deltas. Scroll not supported."""
        pass

    def type(self, text: str) -> None:
        """Type the specified text."""
        self.connection.type(text)

    def wait(self, ms: int = 1000) -> None:
        """Wait for the specified number of milliseconds."""
        time.sleep(ms / 1000)

    def move(self, x: int, y: int) -> None:
        """Move the mouse to the specified coordinates."""
        screen_x, screen_y = self.to_screen_coordinates(x, y)
        self.connection.mouse_move(screen_x, screen_y)

    def keypress(self, keys: list[str]) -> None:
        """
        Press the specified keys.
        
        Args:
            keys: List of keys to press. All keys in the list are pressed simultaneously.
                 For example, ['SUPER', 'R'] will be sent as 'super+r'.
        """
        # Convert all keys to lowercase for consistent mapping
        lowercase_keys = [key.lower() for key in keys]
        
        # Map each key using the CUA_KEY_TO_PIG_KEY dictionary
        mapped_keys = []
        for key in lowercase_keys:
            mapped_key = CUA_KEY_TO_PIG_KEY.get(key, key)
            mapped_keys.append(mapped_key)
        
        # Join keys with '+' to indicate they should be pressed simultaneously
        combo = "+".join(mapped_keys)
        self.connection.key(combo)

    def drag(self, path: list[dict[str, int]]) -> None:
        """Drag the mouse along the specified path."""
        if not path:
            return
            
        # Convert the path to screen coordinates
        screen_path = []
        for point in path:
            screen_x, screen_y = self.to_screen_coordinates(point["x"], point["y"])
            screen_path.append([screen_x, screen_y])
            
        # Move to the first point
        first_point = screen_path[0]
        self.connection.mouse_move(first_point[0], first_point[1])
        
        # Then drag to the last point
        last_point = screen_path[-1]
        self.connection.left_click_drag(last_point[0], last_point[1])



# Map OpenAI CUA key names to Pig key names
CUA_KEY_TO_PIG_KEY = {
    # Special keys
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "arrowup": "up",
    "backspace": "backspace",
    "capslock": "caps_lock",
    "delete": "delete",
    "end": "end",
    "enter": "return",
    "esc": "escape",
    "home": "home",
    "insert": "insert",
    "pagedown": "page_down",
    "pageup": "page_up",
    "tab": "tab",
    "space": "space",
    
    # Modifiers
    "alt": "alt",
    "ctrl": "ctrl",
    "control": "ctrl",
    "cmd": "super",
    "win": "super",
    "meta": "super",
    "shift": "shift",
    "option": "alt",
    
    # Function keys
    "f1": "f1",
    "f2": "f2",
    "f3": "f3",
    "f4": "f4",
    "f5": "f5",
    "f6": "f6",
    "f7": "f7",
    "f8": "f8",
    "f9": "f9",
    "f10": "f10",
    "f11": "f11",
    "f12": "f12",
    
    # Symbols
    "/": "forwardslash",
    "\\": "backslash",
    "-": "minus",
    "=": "equal",
    "[": "bracketleft",
    "]": "bracketright",
    ";": "semicolon",
    "'": "quote",
    "`": "grave",
    ",": "comma",
    ".": "period",
    
    # Shifted symbols
    "!": "exclam",
    "@": "at",
    "#": "numbersign",
    "$": "dollar",
    "%": "percent",
    "^": "caret",
    "&": "ampersand",
    "*": "asterisk",
    "(": "parenleft",
    ")": "parenright",
    "_": "underscore",
    "+": "plus",
    "{": "braceleft",
    "}": "braceright",
    ":": "colon",
    "\"": "quotedbl",
    "~": "asciitilde",
    "<": "less",
    ">": "greater",
    "?": "question",
}
