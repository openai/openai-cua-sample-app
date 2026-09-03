import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { type BrowserMode, type BrowserViewport, type StartTarget } from "@cua-sample/replay-schema";

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

export type BrowserScreenshot = BrowserSessionState & {
  capturedAt: string;
  id: string;
  label: string;
  mimeType: "image/png";
  path: string;
};

export type BrowserObservationSession = {
  captureScreenshot: (label: string) => Promise<BrowserScreenshot>;
  close: () => Promise<void>;
  mode: BrowserMode;
  readState: () => Promise<BrowserSessionState>;
  targetLabel: string;
  viewport: BrowserViewport;
};

// Only trusted worker-side verification and browser tests receive these handles.
export type BrowserSession = BrowserObservationSession & {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

export { launchJavaScriptSession, JavaScriptRuntimeError, type JavaScriptSession } from "./javascript-process.js";
export { isRecord, maxCodeBytes, maxOutputBytes, parseJavaScriptOutput, type JavaScriptOutput, type ScenarioFinalization, type WorkerOperation } from "./protocol.js";

export type LaunchBrowserSessionOptions = {
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
  const browser = await chromium.launch({
    args: [`--window-size=${defaultViewport.width},${defaultViewport.height}`],
    headless: options.browserMode === "headless",
  });
  return createBrowserSession(browser, options);
}

export async function connectBrowserSession(endpoint: string, options: LaunchBrowserSessionOptions): Promise<BrowserSession> {
  return createBrowserSession(await chromium.connect(endpoint, { timeout: 15_000 }), options);
}

async function createBrowserSession(browser: Browser, options: LaunchBrowserSessionOptions): Promise<BrowserSession> {
  const now = options.now ?? (() => new Date());
  const viewport = defaultViewport;
  const resolvedTarget = resolveBrowserStartTarget(options.startTarget, options.workspacePath);
  let context: BrowserContext;
  let page: Page;
  try {
    context = await browser.newContext({ viewport });
    page = await context.newPage();
    await page.goto(resolvedTarget.url, { waitUntil: "load" });
  } catch (error) {
    await browser.close().catch(() => undefined);
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
    async close() {
      try { await context.close(); } finally { await browser.close(); }
    },
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
