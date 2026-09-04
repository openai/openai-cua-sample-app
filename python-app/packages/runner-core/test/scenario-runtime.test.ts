import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runWorkspaceLabBrowserFlow,
  type RunExecutionContext,
  type WorkspaceLabSession,
} from "../src/scenario-runtime.js";

const runtime = vi.hoisted(() => ({
  pythonDesktopCapabilities: { headless: false },
  launchBrowserSession: vi.fn(),
  launchPythonRuntime: vi.fn(),
}));
const lab = vi.hoisted(() => ({
  startWorkspaceLabServer: vi.fn(),
}));

vi.mock("@cua-sample/browser-runtime", () => runtime);
vi.mock("../src/workspace-lab-server.js", () => lab);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("workspace browser cancellation", () => {
  it(
    "closes the browser when cancelled during verification",
    async () => {
      const controller = new AbortController();
      let rejectVerification: ((reason: Error) => void) | undefined;
      let markVerifying!: () => void;
      const verifying = new Promise<void>((resolve) => { markVerifying = resolve; });
      const browserClose = vi.fn(async () => {
        rejectVerification?.(new Error("Browser closed during verification"));
      });
      const pythonClose = vi.fn(async () => {});
      const labClose = vi.fn(async () => {});
      const session = {
        close: browserClose,
        page: { bringToFront: vi.fn(async () => {}) },
        readState: async () => ({ currentUrl: "http://127.0.0.1/lab" }),
        targetLabel: "test lab",
      } as unknown as WorkspaceLabSession;
      runtime.launchBrowserSession.mockResolvedValue(session);
      runtime.launchPythonRuntime.mockResolvedValue({ close: pythonClose });
      lab.startWorkspaceLabServer.mockResolvedValue({
        close: labClose,
        urlFor: () => "http://127.0.0.1/lab",
      });
      const context = {
        detail: {
          workspacePath: "/tmp/cua-lab",
          run: { browserMode: "headful", prompt: "test", verificationEnabled: true },
        },
        signal: controller.signal,
        screenshotDirectory: "/tmp/cua-lab-screenshots",
        captureScreenshot: vi.fn(async () => ({})),
        emitEvent: vi.fn(async () => {}),
        syncBrowserState: vi.fn(async () => {}),
        completeRun: vi.fn(async () => {}),
      } as unknown as RunExecutionContext;
      const completion = runWorkspaceLabBrowserFlow(context, {
        assertOutcome: () => new Promise<void>((_resolve, reject) => {
          rejectVerification = reject;
          markVerifying();
        }),
        buildVerificationDetail: async () => "verified",
        loadedScreenshotLabel: "loaded",
        navigationMessage: "loaded",
        runner: async () => ({ notes: [], verificationMessage: "verified" }),
        sessionLabel: "test lab",
        verifiedScreenshotLabel: "verified",
      }).then(() => null, (error: unknown) => error);

      await verifying;
      controller.abort();

      try {
        await vi.waitFor(() => expect(browserClose).toHaveBeenCalledOnce());
        expect(await completion).toEqual(new Error("Browser closed during verification"));
        expect(labClose).toHaveBeenCalledOnce();
        expect(pythonClose).toHaveBeenCalledOnce();
        expect(runtime.launchPythonRuntime).toHaveBeenCalledOnce();
        expect(session.page.bringToFront).toHaveBeenCalledOnce();
        expect(context.completeRun).not.toHaveBeenCalled();
      } finally {
        rejectVerification?.(new Error("Test cleanup"));
        await completion;
      }
    },
  );
});

describe("Python session startup", () => {
  const flow = {
    assertOutcome: async () => {}, buildVerificationDetail: async () => "verified",
    loadedScreenshotLabel: "loaded", navigationMessage: "loaded", runner: async () => ({ notes: [], verificationMessage: "verified" }),
    sessionLabel: "test", verifiedScreenshotLabel: "verified",
  };
  it("rejects headless execution before allocating resources", async () => {
    const context = { detail: { run: { browserMode: "headless" } } } as RunExecutionContext;
    await expect(runWorkspaceLabBrowserFlow(context, flow)).rejects.toMatchObject({ code: "visible_browser_required" });
    expect(lab.startWorkspaceLabServer).not.toHaveBeenCalled();
    expect(runtime.launchPythonRuntime).not.toHaveBeenCalled();
    expect(runtime.launchBrowserSession).not.toHaveBeenCalled();
  });
  it("closes Python and the lab if browser launch fails", async () => {
    const pythonClose = vi.fn(async () => {});
    const labClose = vi.fn(async () => {});
    lab.startWorkspaceLabServer.mockResolvedValue({ close: labClose, urlFor: () => "http://127.0.0.1/lab" });
    runtime.launchPythonRuntime.mockResolvedValue({ close: pythonClose });
    runtime.launchBrowserSession.mockRejectedValue(new Error("Browser failed"));
    const context = { detail: { workspacePath: "/tmp/lab", run: { browserMode: "headful" } }, signal: new AbortController().signal } as RunExecutionContext;
    await expect(runWorkspaceLabBrowserFlow(context, flow)).rejects.toThrow("Browser failed");
    expect(pythonClose).toHaveBeenCalledOnce();
    expect(labClose).toHaveBeenCalledOnce();
  });
});

it("reports Python cleanup failure and still closes the browser and lab", async () => {
  const pythonClose = vi.fn(async () => { throw new Error("Python teardown failed"); });
  const browserClose = vi.fn(async () => {});
  const labClose = vi.fn(async () => {});
  runtime.launchPythonRuntime.mockResolvedValue({ close: pythonClose });
  runtime.launchBrowserSession.mockResolvedValue({ close: browserClose, page: { bringToFront: async () => {} } });
  lab.startWorkspaceLabServer.mockResolvedValue({ close: labClose, urlFor: () => "http://127.0.0.1/lab" });
  const context = {
    detail: { workspacePath: "/tmp/lab", run: { browserMode: "headful" } },
    signal: new AbortController().signal,
    emitEvent: async () => { throw new Error("Trigger cleanup"); },
  } as unknown as RunExecutionContext;
  await expect(runWorkspaceLabBrowserFlow(context, {} as never))
    .rejects.toMatchObject({ code: "cleanup_failed", message: "Run cleanup failed: Python teardown failed" });
  expect(pythonClose).toHaveBeenCalledOnce();
  expect(browserClose).toHaveBeenCalledOnce();
  expect(labClose).toHaveBeenCalledOnce();
});

it("reports input release failure while still closing browser and lab", async () => {
  const failure = Object.assign(new Error("Input permission revoked"), { code: "input_release_failed" });
  const browserClose = vi.fn(async () => { throw new Error("Browser also failed"); });
  const labClose = vi.fn(async () => { throw new Error("Lab also failed"); });
  runtime.launchPythonRuntime.mockResolvedValue({ close: async () => { throw failure; } });
  runtime.launchBrowserSession.mockResolvedValue({ close: browserClose, page: { bringToFront: async () => {} } });
  lab.startWorkspaceLabServer.mockResolvedValue({ close: labClose, urlFor: () => "http://127.0.0.1/fixture" });
  const context = {
    detail: { workspacePath: "/tmp/fixture", run: { browserMode: "headful" } },
    signal: new AbortController().signal,
    emitEvent: async () => { throw new Error("Trigger cleanup"); },
  } as unknown as RunExecutionContext;
  await expect(runWorkspaceLabBrowserFlow(context, {} as never)).rejects.toMatchObject({
    code: "desktop_cleanup_failed", message: expect.stringContaining("input_release_failed"), hint: expect.stringContaining("restart"),
  });
  expect(browserClose).toHaveBeenCalledOnce();
  expect(labClose).toHaveBeenCalledOnce();
});
