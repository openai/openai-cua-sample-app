from .default import *
from .contrib import *

computers_config = {
    "local-playwright": LocalPlaywrightBrowser,
    "docker": DockerComputer,
    "browserbase": BrowserbaseBrowser,
    "notte-browser": NotteBrowser,
    "scrapybara-browser": ScrapybaraBrowser,
    "scrapybara-ubuntu": ScrapybaraUbuntu,
}
