import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

await mkdir(process.env.HOME, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  env: { HOME: process.env.HOME, PATH: process.env.PATH },
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent("<h1>Browser ready</h1>");
  process.stdout.write(await page.screenshot());
  console.error(`PASS: Chromium ${browser.version()}, 1440 x 900 PNG written to stdout.`);
} finally {
  await browser.close();
}
