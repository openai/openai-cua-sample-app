import os
from typing import Tuple

from dotenv import load_dotenv
from playwright.sync_api import Browser
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page
import requests
import base64

from .base_playwright import BasePlaywrightComputer


load_dotenv()


class AnchorBrowser(BasePlaywrightComputer):
    """
    Computer implementation for Anchor browser (https://anchorbrowser.io)
    Requires an API key in the .env file as ANCHOR_API_KEY

    IMPORTANT: The `goto` and navigation tools are already implemented and recommended
    when using the Anchor computer to help the agent navigate more effectively.
    """

    def __init__(
        self,
        width: int = 1024,
        height: int = 900,
        proxy_active: bool = True,
        adblock_active: bool = True,
        popup_blocking_active: bool = True,
        captcha_active: bool = True,
        timeout: int = 15,
        idle_timeout: int = 2,
        debug: bool = False,
    ):
        """Initialize the Anchor browser session"""
        super().__init__()
        self.api_key = os.getenv("ANCHOR_API_KEY")
        if not self.api_key:
            raise ValueError("ANCHOR_API_KEY not found in .env file")

        self.debug = debug
        self.base_url = "https://api.anchorbrowser.io/api"
        self.base_ws_url = "wss://connect.anchorbrowser.io"
        self.session_id = None
        self.dimensions = (width, height)
        self.proxy_config = {"active": proxy_active}
        self.adblock_config = {
            "active": adblock_active,
            "popup_blocking_active": popup_blocking_active,
        }
        self.captcha_config = {"active": captcha_active}
        self.timeout = timeout
        self.idle_timeout = idle_timeout
        self._browser = None
        self._page = None

        if self.debug:
            print(f"Anchor browser initialized with viewport {width}x{height}")

    def _get_browser_and_page(self) -> Tuple[Browser, Page]:
        """
        Get browser and page objects.
        For Anchor, we don't have direct browser/page objects, but we simulate them
        for compatibility with the BasePlaywrightComputer interface.
        """
        width, height = self.dimensions
        response = requests.post(
            f"{self.base_url}/sessions",
            headers={"anchor-api-key": f"{self.api_key}"},
            json={
                "width": width,
                "height": height,
                "useProxy": self.proxy_config["active"],
                "solveCaptcha": self.captcha_config["active"],
                "sessionTimeout": self.timeout,
                "sessionIdleTimeout": self.idle_timeout,
                "adBlocker": self.adblock_config["active"],
                "popupBlockingActive": self.adblock_config["popup_blocking_active"],
                "headless": False,
            },
        )
        response.raise_for_status()
        self.session_id = response.json().get("id")
        if not self.session_id:
            raise ValueError("Failed to create Anchor browser session")

        browser = self._playwright.chromium.connect_over_cdp(
            f"{self.base_ws_url}/?sessionId={self.session_id}"
        )
        context = browser.contexts[0]
        context.on("page", self._handle_new_page)
        page = context.pages[0]
        page.goto("https://bing.com")
        return browser, page

    def _handle_new_page(self, page: Page):
        """Handle the creation of a new page."""
        print("New page created")
        self._page = page
        page.on("close", self._handle_page_close)

    def _handle_page_close(self, page: Page):
        """Handle the closure of a page."""
        print("Page closed")
        if self._page == page:
            if self._browser.contexts[0].pages:
                self._page = self._browser.contexts[0].pages[-1]
            else:
                print("Warning: All pages have been closed.")
                self._page = None

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Clean up resources when exiting"""
        if self.session_id:
            requests.delete(
                f"{self.base_url}/sessions/{self.session_id}",
                headers={"anchor-api-key": f"{self.api_key}"},
            )
            if self.debug:
                print(f"Ended Anchor session: {self.session_id}")
            self.session_id = None

    def screenshot(self) -> str:
        """
        Capture a screenshot using Anchor's API directly.
        
        Returns:
            str: A base64 encoded string of the screenshot.
        """
        if not self.session_id:
            print("No active session, falling back to standard screenshot")
            return super().screenshot()
            
        try:
            response = requests.get(
                f"{self.base_url}/sessions/{self.session_id}/screenshot",
                headers={"anchor-api-key": f"{self.api_key}"},
            )
            
            if not response.ok:
                print(f"Anchor screenshot failed with status {response.status_code}, falling back to standard screenshot")
                return super().screenshot()
                
            return response.text
            
        except Exception as error:
            print(f"Anchor screenshot failed, falling back to standard screenshot: {error}")
            return super().screenshot()

    def click(self, x: int, y: int, button: str = "left") -> None:
        """
        Click at the specified coordinates using Anchor's API directly.
        
        Args:
            x: The x-coordinate to click.
            y: The y-coordinate to click.
            button: The mouse button to use ('left', 'right', 'back', 'forward', 'wheel').
        """
        if button in ["back", "forward", "wheel"]:
            return super().click(x, y, button)
            
        if not self.session_id:
            print("No active session, falling back to standard click")
            return super().click(x, y, button)
            
        try:
            button_mapping = {"left": "left", "right": "right"}
            button_type = button_mapping.get(button, "left")
            
            # Use Anchor's API to perform the click
            response = requests.post(
                f"{self.base_url}/sessions/{self.session_id}/mouse/click",
                headers={"anchor-api-key": f"{self.api_key}"},
                json={
                    "x": x,
                    "y": y,
                    "button": button_type
                }
            )
            
            if not response.ok:
                print(f"Anchor click failed with status {response.status_code}, falling back to standard click")
                super().click(x, y, button)
                
        except Exception as error:
            print(f"Anchor click failed, falling back to standard click: {error}")
            super().click(x, y, button)

    def type(self, text: str) -> None:
        """
        Type text using Anchor's API directly.
        
        Args:
            text: The text to type.
        """
        if not self.session_id:
            print("No active session, falling back to standard type")
            return super().type(text)
            
        try:
            response = requests.post(
                f"{self.base_url}/sessions/{self.session_id}/keyboard/type",
                headers={"anchor-api-key": f"{self.api_key}"},
                json={
                    "text": text,
                    "delay": 30
                }
            )
            
            if not response.ok:
                print(f"Anchor type failed with status {response.status_code}, falling back to standard type")
                super().type(text)
                
        except Exception as error:
            print(f"Anchor type failed, falling back to standard type: {error}")
            super().type(text)
