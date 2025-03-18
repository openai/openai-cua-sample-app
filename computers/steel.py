import os
from typing import Tuple, Optional
from playwright.sync_api import Browser, Page, Error as PlaywrightError
from .base_playwright import BasePlaywrightComputer
from dotenv import load_dotenv
import base64
from steel import Steel

load_dotenv()


class SteelBrowser(BasePlaywrightComputer):
    """
    Steel is an open-source browser API purpose-built for AI agents.
    Head to https://app.steel.dev to get started.

    If you're running Steel locally or self-hosted, add the following to your .env file:
    STEEL_API_KEY=your_api_key
    STEEL_BASE_URL=http://localhost:3000 (or your self-hosted URL)

    IMPORTANT: The `goto` tool, as defined in playwright_with_custom_functions.py, is strongly recommended when using the Steel computer.
    Make sure to include this tool in your configuration when using the Steel computer.
    """

    def __init__(
        self,
        width: int = 1024,
        height: int = 768,
        proxy: bool = False,
        solve_captcha: bool = False,
        virtual_mouse: bool = True,
        session_timeout: int = 900000,  # 15 minutes default
        ad_blocker: bool = True,
        start_url: str = "https://bing.com"
    ):
        """
        Initialize the Steel browser instance.

        Args:
            width (int): Browser viewport width. Default is 1024.
            height (int): Browser viewport height. Default is 768.
            use_proxy (bool): Whether to use Steel's proxy network (residential IPs). Default is False.
            solve_captcha (bool): Whether to enable automatic CAPTCHA solving. Default is False.
            virtual_mouse (bool): Whether to show a virtual mouse cursor. Default is True.
            session_timeout (int): Session timeout in milliseconds. Default is 5 minutes.
            ad_blocker (bool): Whether to enable ad blocking. Default is True.
            start_url (str): The initial URL to navigate to. Default is "https://bing.com".
        """
        super().__init__()

        # Initialize Steel client
        self.client = Steel(
            steel_api_key=os.getenv("STEEL_API_KEY"), 
            base_url=os.getenv("STEEL_BASE_URL") if os.getenv("STEEL_BASE_URL") else "https://api.steel.dev"
        )
        self.dimensions = (width, height)
        self.proxy = proxy
        self.solve_captcha = solve_captcha
        self.virtual_mouse = virtual_mouse
        self.session_timeout = session_timeout
        self.ad_blocker = ad_blocker
        self.start_url = start_url
        self.session = None

    def _get_browser_and_page(self) -> Tuple[Browser, Page]:
        """
        Create a Steel browser session and connect to it.

        Returns:
            Tuple[Browser, Page]: A tuple containing the connected browser and page objects.
        """
        # Create Steel session
        width, height = self.dimensions
        self.session = self.client.sessions.create(
            use_proxy=self.proxy,
            solve_captcha=self.solve_captcha,
            api_timeout=self.session_timeout,
            block_ads=self.ad_blocker,
            dimensions={"width": width, "height": height}
        )

        print("Steel Session created successfully!")
        print(f"View live session at: {self.session.session_viewer_url}")

        # Connect to the remote browser using Steel's connection URL
        browser = self._playwright.chromium.connect_over_cdp(
            f"wss://connect.steel.dev?apiKey={os.getenv('STEEL_API_KEY')}&sessionId={self.session.id}"
        )
        context = browser.contexts[0]

        # Set up page event handlers
        context.on("page", self._handle_new_page)

        # Add virtual mouse cursor if enabled
        if self.virtual_mouse:
            context.add_init_script("""
            // Only run in the top frame
            if (window.self === window.top) {
                function initCursor() {
                    const CURSOR_ID = '__cursor__';
                    if (document.getElementById(CURSOR_ID)) return;

                    const cursor = document.createElement('div');
                    cursor.id = CURSOR_ID;
                    Object.assign(cursor.style, {
                        position: 'fixed',
                        top: '0px',
                        left: '0px',
                        width: '20px',
                        height: '20px',
                        backgroundImage: 'url("data:image/svg+xml;utf8,<svg width=\\'16\\' height=\\'16\\' viewBox=\\'0 0 20 20\\' fill=\\'black\\' outline=\\'white\\' xmlns=\\'http://www.w3.org/2000/svg\\'><path d=\\'M15.8089 7.22221C15.9333 7.00888 15.9911 6.78221 15.9822 6.54221C15.9733 6.29333 15.8978 6.06667 15.7555 5.86221C15.6133 5.66667 15.4311 5.52445 15.2089 5.43555L1.70222 0.0888888C1.47111 0 1.23555 -0.0222222 0.995555 0.0222222C0.746667 0.0755555 0.537779 0.186667 0.368888 0.355555C0.191111 0.533333 0.0755555 0.746667 0.0222222 0.995555C-0.0222222 1.23555 0 1.47111 0.0888888 1.70222L5.43555 15.2222C5.52445 15.4445 5.66667 15.6267 5.86221 15.7689C6.06667 15.9111 6.28888 15.9867 6.52888 15.9955H6.58221C6.82221 15.9955 7.04445 15.9333 7.24888 15.8089C7.44445 15.6845 7.59555 15.52 7.70221 15.3155L10.2089 10.2222L15.3022 7.70221C15.5155 7.59555 15.6845 7.43555 15.8089 7.22221Z\\' ></path></svg>")',
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

        # Navigate to start URL
        page.goto(self.start_url)

        return browser, page

    def _handle_new_page(self, page: Page):
        """Handle creation of a new page."""
        print("New page created")
        self._page = page
        page.on("close", self._handle_page_close)

    def _handle_page_close(self, page: Page):
        """Handle page closure."""
        print("Page closed")
        if self._page == page:
            if self._browser.contexts[0].pages:
                self._page = self._browser.contexts[0].pages[-1]
            else:
                print("Warning: All pages have been closed.")
                self._page = None

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Clean up resources when exiting."""
        if self._page:
            self._page.close()
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()

        # Release the Steel session
        if self.session:
            print("Releasing Steel session...")
            self.client.sessions.release(self.session.id)
            print(
                f"Session completed. View replay at {self.session.session_viewer_url}")

    def screenshot(self) -> str:
        """
        Capture a screenshot of the current viewport using CDP.

        Returns:
            str: Base64 encoded screenshot data
        """
        try:
            cdp_session = self._page.context.new_cdp_session(self._page)
            result = cdp_session.send("Page.captureScreenshot", {
                "format": "png",
                "fromSurface": True
            })
            return result['data']
        except PlaywrightError as error:
            print(
                f"CDP screenshot failed, falling back to standard screenshot: {error}")
            return super().screenshot()
