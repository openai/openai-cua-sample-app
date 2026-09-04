import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { type BrowserMode, type BrowserViewport, type StartTarget } from "@cua-sample/replay-schema";

import type { PythonRuntime } from "./python-runtime.js";
export { launchPythonRuntime, PythonRuntimeError, pythonDesktopCapabilities, type PythonRuntime, type RuntimeOutputItem } from "./python-runtime.js";

export const defaultViewport: BrowserViewport = {
  height: 900,
  width: 1440,
};

export type BrowserStartTarget = {
  targetLabel: string;
  url: string;
};

export type BrowserSessionState = {
  currentUrl: string;
  pageTitle?: string;
};

export type ModelObservation = {
  base64: string;
  width?: number;
  height?: number;
  source: "code_tool";
};

export type BrowserScreenshot = BrowserSessionState & {
  capturedAt: string;
  id: string;
  label: string;
  mimeType: "image/png";
  path: string;
};

export type BrowserSession = {
  browser: Browser;
  captureScreenshot: (label: string) => Promise<BrowserScreenshot>;
  close: () => Promise<void>;
  context: BrowserContext;
  execution?: PythonRuntime;
  mode: BrowserMode;
  page: Page;
  readState: () => Promise<BrowserSessionState>;
  targetLabel: string;
  viewport: BrowserViewport;
};

type LaunchBrowserSessionOptions = {
  browserMode: BrowserMode;
  now?: () => Date;
  screenshotDir: string;
  startTarget: StartTarget;
  workspacePath: string;
};

function sanitizeLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "capture";
}

export function resolveBrowserStartTarget(
  startTarget: StartTarget,
  workspacePath: string,
): BrowserStartTarget {
  if (startTarget.kind === "remote_url") {
    return {
      targetLabel: startTarget.label ?? startTarget.url,
      url: startTarget.url,
    };
  }

  const absolutePath = join(workspacePath, startTarget.path);

  return {
    targetLabel: startTarget.label ?? startTarget.path,
    url: pathToFileURL(absolutePath).href,
  };
}

export async function launchBrowserSession(
  options: LaunchBrowserSessionOptions,
): Promise<BrowserSession> {
  const now = options.now ?? (() => new Date());
  const viewport = defaultViewport;
  const resolvedTarget = resolveBrowserStartTarget(
    options.startTarget,
    options.workspacePath,
  );
  const browserServer = await chromium.launchServer({
    host: "127.0.0.1",
    timeout: 15_000,
    args: [`--window-size=${viewport.width},${viewport.height}`],
    // The runner owns signal handling and awaits worker/browser cleanup.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    headless: options.browserMode === "headless",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "OPENAI_API_KEY")),
  });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page;
  let closing: Promise<void> | undefined;
  function close() {
    return closing ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            try { await context?.close(); }
            finally {
              try { await browser?.close(); }
              finally { await browserServer.close(); }
            }
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Browser cleanup exceeded 1000ms.")), 1_000);
          }),
        ]);
      } catch (error) {
        // The parent retains a kill handle even when a browser operation hangs.
        await browserServer.kill();
        throw error;
      } finally { clearTimeout(timer); }
    })();
  }
  try {
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 15_000 });
    context = await browser.newContext({ viewport });
    page = await context.newPage();
    await page.goto(resolvedTarget.url, { waitUntil: "load" });
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  let screenshotCount = 0;

  return {
    browser,
    async captureScreenshot(label) {
      screenshotCount += 1;
      await mkdir(options.screenshotDir, { recursive: true });

      const path = join(
        options.screenshotDir,
        `${String(screenshotCount).padStart(3, "0")}-${sanitizeLabel(label)}.png`,
      );
      await page.screenshot({
        path,
      });

      const pageTitle = await page.title();

      return {
        capturedAt: now().toISOString(),
        currentUrl: page.url(),
        id: `screenshot-${screenshotCount}`,
        label,
        mimeType: "image/png",
        path,
        ...(pageTitle ? { pageTitle } : {}),
      };
    },
    close,
    context,
    mode: options.browserMode,
    page,
    async readState() {
      const pageTitle = await page.title();

      return {
        currentUrl: page.url(),
        ...(pageTitle ? { pageTitle } : {}),
      };
    },
    targetLabel: resolvedTarget.targetLabel,
    viewport,
  };
}
