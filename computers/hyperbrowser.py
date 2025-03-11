import os
from typing import Tuple

from dotenv import load_dotenv
from hyperbrowser import Hyperbrowser
from hyperbrowser.models.session import CreateSessionParams, ScreenConfig
from playwright.sync_api import Browser, Page
from playwright.sync_api import Error as PlaywrightError

from .base_playwright import BasePlaywrightComputer

load_dotenv()


class HyperbrowserBrowser(BasePlaywrightComputer):
    """
    Hyperbrowser is the next-generation platform for effortless, scalable browser automation. It provides a cloud-based browser instance 
    that can be controlled through code, eliminating the need for local infrastructure setup.
    
    Key features include:
    - Instant Scalability: Spin up hundreds of browser sessions in seconds without infrastructure headaches
    - Simple Integration: Works seamlessly with popular tools like Puppeteer and Playwright
    - Powerful APIs: Easy to use APIs for managing sessions, scraping/crawling any site, and much more
    - Production Ready: Enterprise-grade reliability and security built-in
    - Bypass Anti-Bot Measures: Built-in stealth mode, ad blocking, automatic CAPTCHA solving, and rotating proxies
    
    IMPORTANT: This Hyperbrowser computer requires the use of the `goto` tool defined in playwright_with_custom_functions.py.
    Make sure to include this tool in your configuration when using the Hyperbrowser computer.
    """

    def __init__(
        self,
        width: int = 1024,
        height: int = 768,
        proxy: bool = False,
        virtual_mouse: bool = True,
        ad_blocker: bool = False,
    ):
        """
        Initialize the Hyperbrowser instance.
        Additional configuration options for features such as persistent cookies, ad blockers, file downloads and more can be found in the Hyperbrowser API documentation: https://docs.hyperbrowser.ai/
        
        In Hyperbrowser, a Session is a dedicated, cloud-based browser instance that's fully controllable through code.
        Each Session keeps its own cookies, storage, and browsing context.

        Args:
            width (int): The width of the browser viewport. Default is 1024.
            height (int): The height of the browser viewport. Default is 768.
            proxy (bool): Whether to use a proxy for the session. Default is False. Enables rotating proxies to bypass IP-based blocking.
            virtual_mouse (bool): Whether to enable the virtual mouse cursor. Default is True.
            ad_blocker (bool): Whether to enable the built-in ad blocker. Default is False.
        """
        super().__init__()
        self.hb = Hyperbrowser(api_key=os.getenv("HYPERBROWSER_API_KEY"))
        self.session = None
        self.dimensions = (width, height)
        self.proxy = proxy
        self.virtual_mouse = virtual_mouse
        self.ad_blocker = ad_blocker

    def _get_browser_and_page(self) -> Tuple[Browser, Page]:
        """
        Create a Hyperbrowser session and connect to it.
        
        This method creates a cloud-based browser session using Hyperbrowser's Sessions API,
        configures it with the specified parameters, and establishes a connection using Playwright.

        Returns:
            Tuple[Browser, Page]: A tuple containing the connected browser and page objects.
        """
        # Create a session on Hyperbrowser with specified parameters
        width, height = self.dimensions
        self.session = self.hb.sessions.create(
            CreateSessionParams(
                use_proxy=self.proxy,
                adblock=self.ad_blocker,
                screen=ScreenConfig(width=width, height=height),
            )
        )

        # Print the live session URL
        print(f"Watch and control this browser live at {self.session.live_url}")

        # Connect to the remote session
        browser = self._playwright.chromium.connect_over_cdp(
            self.session.ws_endpoint, timeout=60000
        )
        context = browser.contexts[0]

        # Add event listeners for page creation and closure
        context.on("page", self._handle_new_page)

        # Only add the init script if virtual_mouse is True
        if self.virtual_mouse:
            context.add_init_script("""
            // Only run in the top frame
            if (window.self === window.top) {
                function initCursor() {
                    const CURSOR_ID = '__cursor__';

                    // Check if cursor element already exists
                    if (document.getElementById(CURSOR_ID)) return;

                    const cursor = document.createElement('div');
                    cursor.id = CURSOR_ID;
                    Object.assign(cursor.style, {
                        position: 'fixed',
                        top: '0px',
                        left: '0px',
                        width: '20px',
                        height: '20px',
                        backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'black\\' stroke=\\'white\\' stroke-width=\\'1\\' stroke-linejoin=\\'round\\' stroke-linecap=\\'round\\'><polygon points=\\'2,2 2,22 8,16 14,22 17,19 11,13 20,13\\'/></svg>")',
                        backgroundSize: 'cover',
                        pointerEvents: 'none',
                        zIndex: '99999',
                        transform: 'translate(-2px, -2px)',
                    });

                    document.body.appendChild(cursor);

                    document.addEventListener("mousemove", (e) => {
                        cursor.style.top = e.clientY + "px";
                        cursor.style.left = e.clientX + "px";
                    });
                }

                // Use requestAnimationFrame for early execution
                requestAnimationFrame(function checkBody() {
                    if (document.body) {
                        initCursor();
                    } else {
                        requestAnimationFrame(checkBody);
                    }
                });
            }
            """)

        page = context.pages[0]
        page.on("close", self._handle_page_close)

        page.goto("https://bing.com")

        return browser, page

    def _handle_new_page(self, page: Page):
        """
        Handle the creation of a new page in the Hyperbrowser session.
        
        This event handler is triggered when a new page is created in the browser context,
        allowing for tracking and management of multiple pages within a single session.
        """
        print("New page created")
        self._page = page
        page.on("close", self._handle_page_close)

    def _handle_page_close(self, page: Page):
        """
        Handle the closure of a page in the Hyperbrowser session.
        
        This event handler is triggered when a page is closed, ensuring proper cleanup
        and management of the active page reference within the session.
        """
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
        
        This method ensures proper cleanup of the Hyperbrowser session, closing pages and browsers,
        stopping the Playwright instance, and providing a link to view the session replay.

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

        if self.session:
            print(
                f"Session completed. View replay at https://app.hyperbrowser.ai/sessions/{self.session.id}"
            )

    def screenshot(self) -> str:
        """
        Capture a screenshot of the current viewport in the Hyperbrowser session using CDP.
        
        This method uses Chrome DevTools Protocol (CDP) to capture a high-quality screenshot
        of the current page, with a fallback to standard Playwright screenshot functionality.

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
