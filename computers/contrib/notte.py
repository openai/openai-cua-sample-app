import os
from typing import final
from typing_extensions import override
from playwright.sync_api import Browser, Page, Error as PlaywrightError

from dotenv import load_dotenv
from computers.shared.base_playwright import BasePlaywrightComputer
from notte_sdk import NotteClient

_ = load_dotenv()

@final
class NotteBrowser(BasePlaywrightComputer):
    """
    Notte is a headless browser platform that offers a remote browser API. You can use it to control thousands of browsers from anywhere.
    You can find more information about Notte at https://www.notte.cc/computer-use or view our OpenAI CUA Quickstart at https://docs.notte.cc/integrations/openai-cua/introduction.

    IMPORTANT: This Notte computer requires the use of the `goto` tool defined in playwright_with_custom_functions.py.
    Make sure to include this tool in your configuration when using the Notte computer.
    """

    def __init__(
        self,
        width: int = 1024,
        height: int = 768,
        proxy: bool = False,
    ) -> None:
        """
        Initialize the Browserbase instance. Additional configuration options for features such as persistent cookies, ad blockers, file downloads and more can be found in the Browserbase API documentation: https://docs.browserbase.com/reference/api/create-a-session

        Args:
            width (int): The width of the browser viewport. Default is 1024.
            height (int): The height of the browser viewport. Default is 768.
            region (str): The region for the Browserbase session. Default is "us-west-2". Pick a region close to you for better performance. https://docs.browserbase.com/guides/multi-region
            proxy (bool): Whether to use a proxy for the session. Default is False. Turn on proxies if you're browsing is frequently interrupted. https://docs.browserbase.com/features/proxies
        """
        super().__init__()
        self.notte = NotteClient(api_key=os.getenv("NOTTE_API_KEY"))
        self.session = self.notte.Session(
            viewport_width=width,
            viewport_height=height,
            proxies=proxy,
        )
        self.width = width
        self.height = height

    @override
    def get_dimensions(self) -> tuple[int, int]:
        return (self.width, self.height)

    @override
    def _get_browser_and_page(self) -> tuple[Browser, Page]:
        """
        Create a Browserbase session and connect to it.

        Returns:
            Tuple[Browser, Page]: A tuple containing the connected browser and page objects.
        """
        # Create a session on Browserbase with specified parameters
        self.session.start()
        # Connect to the remote session
        cdp_url = self.session.cdp_url()
        browser = self._playwright.chromium.connect_over_cdp(
            endpoint_url=cdp_url,
            timeout=60000
        )
        context = browser.contexts[0]

        # Add event listeners for page creation and closure
        context.on("page", self._handle_new_page)


        page = context.pages[0]
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

    @override
    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Clean up resources when exiting the context manager.

        Args:
            exc_type: The type of the exception that caused the context to be exited.
            exc_val: The exception instance that caused the context to be exited.
            exc_tb: A traceback object encapsulating the call stack at the point where the exception occurred.
        """
        super().__exit__(exc_type, exc_val, exc_tb)

        if self.session:
            print(
                f"Session completed. Check our docs to learn more about session replays: https://docs.notte.cc"
            )
            self.session.stop()

    @override
    def screenshot(self) -> str:
        """
        Capture a screenshot of the current viewport using CDP.

        Returns:
            str: A base64 encoded string of the screenshot.
        """
        if self._page is None:
            raise ValueError("No page to screenshot")
        try:
            # Get CDP session from the page
            cdp_session = self._page.context.new_cdp_session(self._page)

            # Capture screenshot using CDP
            result = cdp_session.send("Page.captureScreenshot", {
                "format": "png",
                "fromSurface": True
            })

            return result['data']
        except PlaywrightError as error:
            print(f"CDP screenshot failed, falling back to standard screenshot: {error}")
            return super().screenshot()
