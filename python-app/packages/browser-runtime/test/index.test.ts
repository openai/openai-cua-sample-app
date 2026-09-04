import { chromium, type Browser, type BrowserServer } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchBrowserSession, resolveBrowserStartTarget } from "../src/index.js";

const launchOptions = {
  browserMode: "headless" as const,
  screenshotDir: "/tmp/run-123/screenshots",
  startTarget: { kind: "remote_url" as const, url: "http://127.0.0.1:3101" },
  workspacePath: "/tmp/run-123",
};

function mockBrowser() {
  const page = { goto: vi.fn().mockResolvedValue(undefined) };
  const context = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  };
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue(context),
  };
  const server = { wsEndpoint: () => "ws://127.0.0.1/fixture", close: vi.fn(async () => {}), kill: vi.fn(async () => {}) };
  vi.spyOn(chromium, "launchServer").mockResolvedValue(server as unknown as BrowserServer);
  vi.spyOn(chromium, "connect").mockResolvedValue(browser as unknown as Browser);
  return { browser, context, page, server };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("browser runtime", () => {
  it("resolves workspace file targets against the mutable workspace", () => {
    const resolved = resolveBrowserStartTarget(
      {
        kind: "workspace_file",
        label: "workspace:index.html",
        path: "index.html",
      },
      "/tmp/run-123",
    );

    expect(resolved.targetLabel).toBe("workspace:index.html");
    expect(resolved.url).toBe("file:///tmp/run-123/index.html");
  });

  it("passes remote targets through untouched", () => {
    const resolved = resolveBrowserStartTarget(
      {
        kind: "remote_url",
        url: "http://127.0.0.1:3101",
      },
      "/tmp/run-123",
    );

    expect(resolved.targetLabel).toBe("http://127.0.0.1:3101");
    expect(resolved.url).toBe("http://127.0.0.1:3101");
  });

  it.each(["newContext", "newPage", "goto"] as const)(
    "closes the browser if %s fails during startup",
    async (stage) => {
      const { browser, context, page } = mockBrowser();
      const failure = new Error("Browser startup failed.");
      const operation = { newContext: browser.newContext, newPage: context.newPage, goto: page.goto }[stage];
      operation.mockRejectedValueOnce(failure);

      await expect(launchBrowserSession(launchOptions)).rejects.toBe(failure);
      expect(browser.close).toHaveBeenCalledOnce();
    },
  );

  it("closes the browser even if closing its context fails", async () => {
    const { browser, context } = mockBrowser();
    const session = await launchBrowserSession(launchOptions);
    const failure = new Error("Context close failed.");
    context.close.mockRejectedValueOnce(failure);

    await expect(session.close()).rejects.toBe(failure);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("kills the parent-owned browser when graceful cleanup stalls", async () => {
    vi.useFakeTimers();
    const { context, server } = mockBrowser();
    const session = await launchBrowserSession(launchOptions);
    context.close.mockImplementation(() => new Promise(() => {}));
    const closed = expect(session.close()).rejects.toThrow("Browser cleanup exceeded");
    await vi.advanceTimersByTimeAsync(1_000);
    await closed;
    expect(server.kill).toHaveBeenCalledOnce();
  });
});
