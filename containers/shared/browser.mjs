import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

export async function openBrowser(headless = true) {
  await mkdir(process.env.HOME, { recursive: true });
  const browser = await chromium.launch({
    headless,
    chromiumSandbox: true,
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
    },
    args: ["--disable-extensions", "--window-position=0,0", "--window-size=1440,900"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  return { browser, context, page };
}
