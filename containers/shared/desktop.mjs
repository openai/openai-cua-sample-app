import { writeFile } from "node:fs/promises";
import { openBrowser } from "./browser.mjs";

const { browser, page } = await openBrowser(false);
await page.goto("data:text/html,<title>CUA desktop</title><h1>CUA desktop ready</h1>");
await page.locator("h1").waitFor();
await writeFile("/tmp/browser-ready", "ready");
browser.on("disconnected", () => process.exit(1));
