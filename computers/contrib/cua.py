import asyncio
import base64
import os
import time
from typing import Dict, List, Optional, Tuple, Literal

try:
    from computer import Computer as CuaComputer
except ImportError:
    raise ImportError("The cua-computer package is required. Install it with 'pip install cua-computer'")

class CuaComputerAdapter:
    """Adapter class to convert between sync and async methods for cua-computer."""
    
    def __init__(self, computer):
        self.computer = computer
        self.loop = asyncio.get_event_loop()
        
    def _run_async(self, coro):
        """Run an async coroutine in a synchronous context."""
        return self.loop.run_until_complete(coro)
    
    def screenshot(self):
        """Take a screenshot of the VM."""
        screenshot_bytes = self._run_async(self.computer.interface.screenshot())
        return base64.b64encode(screenshot_bytes).decode('utf-8')
        
    def click(self, x: int, y: int, button: str = "left"):
        """Click at the specified coordinates."""
        self._run_async(self.computer.interface.move_cursor(x, y))
        if button == "right":
            self._run_async(self.computer.interface.right_click())
        else:
            self._run_async(self.computer.interface.left_click())
        
    def double_click(self, x: int, y: int):
        """Double click at the specified coordinates."""
        self._run_async(self.computer.interface.move_cursor(x, y))
        self._run_async(self.computer.interface.left_click())
        time.sleep(0.1)
        self._run_async(self.computer.interface.left_click())
        
    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int):
        """Scroll at the specified coordinates."""
        self._run_async(self.computer.interface.move_cursor(x, y))
        self._run_async(self.computer.interface.scroll(scroll_y // 50))
        
    def type(self, text: str):
        """Type the specified text."""
        self._run_async(self.computer.interface.type_text(text))
        
    def wait(self, ms: int = 1000):
        """Wait for the specified number of milliseconds."""
        time.sleep(ms / 1000)
        
    def move(self, x: int, y: int):
        """Move the cursor to the specified coordinates."""
        self._run_async(self.computer.interface.move_cursor(x, y))
        
    def keypress(self, keys: List[str]):
        """Press the specified keys."""
        if len(keys) > 1:
            self._run_async(self.computer.interface.hotkey(*keys))
        else:
            for key in keys:
                # Map common key names to CUA equivalents
                if key.lower() == "enter":
                    self._run_async(self.computer.interface.press_key("return"))
                elif key.lower() == "space":
                    self._run_async(self.computer.interface.press_key("space"))
                else:
                    self._run_async(self.computer.interface.press_key(key))
                
    def drag(self, path: List[Dict[str, int]]):
        """Drag from the start point to the end point."""
        if len(path) < 2:
            return
        
        # Move to start position
        start = path[0]
        self._run_async(self.computer.interface.move_cursor(start[0], start[1]))
        
        # Start dragging
        self._run_async(self.computer.interface.mouse_down())
        
        # Move through each point in the path
        for point in path[1:]:
            self._run_async(self.computer.interface.move_cursor(point[0], point[1]))
            time.sleep(0.05)  # Small delay between movements
            
        # Release at final position
        self._run_async(self.computer.interface.mouse_up())

    def get_current_url(self) -> str:
        """Get the current URL (only applicable for browser environments)."""
        # Not directly available in cua-computer, but could be implemented
        # in a more sophisticated way if needed
        return ""


class CuaBaseComputer:
    """Base implementation of the Computer protocol using cua-computer and lume virtualization."""
    
    def __init__(
        self,
        display: str = "1024x768",
        memory: str = "4GB",
        cpu: str = "2",
        os: str = "macos",
        image: str = None
    ):
        self.display = display
        self.memory = memory
        self.cpu = cpu
        self.os = os
        self.image = image
        self.computer = None
        self.adapter = None
        self._width, self._height = map(int, display.split('x'))
        
    @property
    def dimensions(self) -> Tuple[int, int]:
        return (self._width, self._height)
    
    def __enter__(self):
        # Create and run the cua-computer instance
        self.computer = CuaComputer(
            display=self.display,
            memory=self.memory,
            cpu=self.cpu,
            os=self.os,
            image=self.image
        )
        
        # Run the VM
        asyncio.get_event_loop().run_until_complete(self.computer.run())
        
        # Create the adapter for sync operations
        self.adapter = CuaComputerAdapter(self.computer)
        
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        # Stop the VM when we're done
        if self.computer:
            asyncio.get_event_loop().run_until_complete(self.computer.stop())
    
    # Delegate all the Computer protocol methods to the adapter
    def screenshot(self) -> str:
        return self.adapter.screenshot()
    
    def click(self, x: int, y: int, button: str = "left") -> None:
        self.adapter.click(x, y, button)
    
    def double_click(self, x: int, y: int) -> None:
        self.adapter.double_click(x, y)
    
    def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        self.adapter.scroll(x, y, scroll_x, scroll_y)
    
    def type(self, text: str) -> None:
        self.adapter.type(text)
    
    def wait(self, ms: int = 1000) -> None:
        self.adapter.wait(ms)
    
    def move(self, x: int, y: int) -> None:
        self.adapter.move(x, y)
    
    def keypress(self, keys: List[str]) -> None:
        self.adapter.keypress(keys)
    
    def drag(self, path: List[Dict[str, int]]) -> None:
        self.adapter.drag(path)
    
    def get_current_url(self) -> str:
        return self.adapter.get_current_url()
    
    # Additional methods that could be useful for function calling
    def goto(self, url: str) -> None:
        """Navigate to a specific URL (emulating browser functionality)."""
        # This would require launching a browser and typing the URL
        self.adapter.type(url)
        self.adapter.keypress(["Enter"])


class CuaMacOSComputer(CuaBaseComputer):
    """Implementation of the Computer protocol using cua-computer and lume virtualization for macOS."""
    
    def __init__(
        self,
        display: str = "1024x768",
        memory: str = "4GB",
        cpu: str = "2"
    ):
        super().__init__(
            display=display,
            memory=memory,
            cpu=cpu,
            os="macos",
            image="macos-sequoia-cua:latest"
        )
    
    @property
    def environment(self) -> Literal["windows", "mac", "linux", "browser"]:
        return "mac"
    
    def back(self) -> None:
        """Go back (browser functionality) on macOS."""
        self.adapter.keypress(["Command", "Left"]) 
