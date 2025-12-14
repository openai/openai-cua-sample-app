import os
from typing import Tuple

from playwright.sync_api import Browser, Page, Error as PlaywrightError
from ..shared.base_playwright import BasePlaywrightComputer
from dotenv import load_dotenv
from tzafon import Computer

load_dotenv()

class TzafonBrowser(BasePlaywrightComputer):
    def get_dimensions(self):
        return self.dimensions

    def __init__(
        self,
        width: int = 1024,
        height: int = 768,
    ):
        """
        Initialize the TzafonBrowser instance. 

        Tzafon gives you programmatic control of browsers and desktops in seconds. Full stealth. Lightning fast.

        Get started at https://tzafon.ai
        Read the docs at https://docs.tzafon.ai/overview
        """
        super().__init__()

        if not os.getenv("TZAFON_API_KEY"):
            raise ValueError("TZAFON_API_KEY is not set. Get your API key from https://tzafon.ai")

        api_key = os.getenv("TZAFON_API_KEY")

        client = Computer(api_key=api_key)
        self.tz = client.create(kind="browser")
        self.base_url = "https://api.tzafon.ai"
        self.cdp_url = f"{self.base_url}/computers/{self.tz.id}/cdp?token={api_key}"
        self.dimensions = (width, height)

    def _get_browser_and_page(self) -> Tuple[Browser, Page]:
        """
        Create a Tzafon session and connect to it.

        """
        width, height = self.dimensions
 
        # Connect to the remote session
        browser = self._playwright.chromium.connect_over_cdp(
            self.cdp_url, timeout=60000
        )

        # Use the first context or create one if none exists
        if browser.contexts: context = browser.contexts[0]
        else: context = browser.new_context()

        # Add event listeners for page creation and closure
        context.on("page", self._handle_new_page)

        # Create a new page and set viewport
        page = context.pages[0] if context.pages else context.new_page()
        page.set_viewport_size({"width": width, "height": height})
        page.on("close", self._handle_page_close)
       
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
        """
        Clean up resources when exiting the context manager.

        Args:
            exc_type: The type of the exception that caused the context to be exited.
            exc_val: The exception instance that caused the context to be exited.
            exc_tb: A traceback object encapsulating the call stack at the point where the exception occurred.
        """
        if self._page:
            self._page.close()
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()
        if self.tz:
            self.tz.terminate()

    def screenshot(self) -> str:
        """
        Capture a screenshot of the current viewport using CDP.

        Returns:
            str: A base64 encoded string of the screenshot.
        """
        try:
            # Get CDP session from the page
            cdp_session = self._page.context.new_cdp_session(self._page)

            # Capture screenshot using CDP
            result = cdp_session.send(
                "Page.captureScreenshot", {"format": "png", "fromSurface": True}
            )

            return result["data"]
        except PlaywrightError as error:
            print(
                f"CDP screenshot failed, falling back to standard screenshot: {error}"
            )
            return super().screenshot()
