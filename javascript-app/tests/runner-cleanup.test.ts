import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RunnerManager } from "../src/runner-manager.js";
import { runWorkspaceLabBrowserFlow } from "../src/scenario-runtime.js";
import { waitForRunStatus } from "./support.js";

const fixture = vi.hoisted(() => ({
  template: "", screenshot: 0, browserClose: vi.fn(), serverClose: vi.fn(),
}));
vi.mock("../src/executor-registry.js", () => ({ createDefaultRunExecutor: vi.fn() }));
vi.mock("../src/lab-catalog.js", () => ({ getScenarioById: (id: string) => id === "fixture" ? {
  id, labId: "paint", category: "creativity", title: "Synthetic fixture", description: "Cleanup fixture",
  defaultPrompt: "Complete fixture.", workspaceTemplatePath: fixture.template, tags: ["fixture"],
} : undefined }));
vi.mock("../src/workspace-lab-server.js", () => ({ startWorkspaceLabServer: async () => ({
  close: fixture.serverClose, urlFor: () => "http://127.0.0.1:1/synthetic",
}) }));
vi.mock("../src/browser/javascript-process.js", () => ({ launchJavaScriptSession: async () => ({
  close: fixture.browserClose, mode: "headless", targetLabel: "Synthetic fixture", viewport: { width: 1440, height: 900 },
  readState: async () => ({ currentUrl: "http://127.0.0.1:1/synthetic" }),
  captureScreenshot: async (label: string) => ({
    capturedAt: new Date().toISOString(), currentUrl: "http://127.0.0.1:1/synthetic",
    id: `synthetic-${++fixture.screenshot}`, label, mimeType: "image/png", path: join(fixture.template, `${fixture.screenshot}.png`),
  }),
}) }));
const roots: string[] = [];
beforeAll(async () => {
  fixture.template = await mkdtemp(join(tmpdir(), "cua-cleanup-template-"));
  await writeFile(join(fixture.template, "index.html"), "Synthetic workspace.");
});
afterAll(() => rm(fixture.template, { recursive: true, force: true }));
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("terminal state after owned browser cleanup", () => {
  for (const stop of [true, false]) {
    it.each(["browser", "server", "both", "none"])(`reports %s cleanup accurately, stop=${stop}`, async (failure) => {
      const root = await mkdtemp(join(tmpdir(), "cua-cleanup-run-")); roots.push(root);
      const ready = deferred(), finishWork = deferred(), entered = deferred(), release = deferred();
      fixture.browserClose.mockImplementation(async () => {
        entered.resolve(); await release.promise;
        if (failure === "browser" || failure === "both") throw new Error("Synthetic browser cleanup failure");
      });
      fixture.serverClose.mockImplementation(async () => {
        if (failure === "server" || failure === "both") throw new Error("Synthetic lab server cleanup failure");
      });
      const manager = new RunnerManager({ dataRoot: root, executorFactory: () => ({ execute: context =>
        runWorkspaceLabBrowserFlow(context, {
          loadedScreenshotLabel: "loaded", finalScreenshotLabel: "finished", navigationMessage: "Synthetic navigation", sessionLabel: "Synthetic fixture",
          runner: async () => {
            ready.resolve();
            if (stop) await new Promise<void>(resolve => {
              if (context.signal.aborted) resolve();
              else context.signal.addEventListener("abort", () => resolve(), { once: true });
            });
            else await finishWork.promise;
            if (stop) throw new Error("Synthetic work interrupted");
            return { notes: ["Synthetic completion"] };
          },
        }),
      }) });
      let stopping: ReturnType<RunnerManager["stopRun"]> | undefined;
      try {
        const started = await manager.startRun({ scenarioId: "fixture", prompt: "Complete fixture." });
        await ready.promise;
        if (stop) stopping = manager.stopRun(started.run.id);
        else finishWork.resolve();
        await entered.promise;
        expect((await manager.getActiveRunDetail())?.run.status).toBe("running");
        await expect(manager.startRun({ scenarioId: "fixture", prompt: "Another run." })).rejects.toMatchObject({ code: "run_already_active" });
        release.resolve();
        const expected = failure !== "none" ? "failed" : stop ? "cancelled" : "completed";
        const detail = stopping ? await stopping : await waitForRunStatus(manager, started.run.id, expected);
        expect(detail.run.status).toBe(expected);
        expect(fixture.browserClose).toHaveBeenCalledOnce();
        expect(fixture.serverClose).toHaveBeenCalledOnce();
        const replay = await manager.getReplayBundle(started.run.id);
        expect(replay.run.status).toBe(expected);
        expect(replay.events.filter(event => ["run_failed", "run_completed", "run_cancelled"].includes(event.type))).toHaveLength(1);
        if (failure !== "none") {
          expect(replay.run.summary?.notes.join(" ")).toContain("cleanup_failed");
          expect(replay.run.summary?.notes.join(" ")).toContain(failure === "browser" ? "Synthetic browser" : "Synthetic lab server");
          if (failure === "both") expect(replay.run.summary?.notes.join(" ")).toContain("Synthetic browser");
        }
        expect((await manager.stopRun(started.run.id)).run.status).toBe(expected);
        expect(await manager.getActiveRunDetail()).toBeNull();
      } finally {
        finishWork.resolve(); release.resolve();
        await stopping;
        await manager.shutdown();
      }
    });
  }
});
