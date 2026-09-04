import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { browserScreenshotArtifactSchema, type RunEvent } from "@cua-sample/replay-schema";
import { listScenarios } from "@cua-sample/scenario-kit";
import { PythonRuntimeError } from "@cua-sample/browser-runtime";

import { RunnerCoreError, RunnerManager } from "../src/index.js";

const tempRoots: string[] = [];
vi.mock("../src/executor-registry.js", () => ({
  createDefaultRunExecutor: () => { throw new Error("Generic manager tests must provide an executor."); },
}));
const fixture = vi.hoisted(() => ({ workspaceTemplatePath: "" }));
vi.mock("@cua-sample/scenario-kit", () => {
  const scenario = () => ({
    id: "fixture-scenario", labId: "paint", category: "creativity", title: "Fixture",
    description: "Synthetic runner test", defaultPrompt: "Complete fixture.",
    workspaceTemplatePath: fixture.workspaceTemplatePath,
    startTarget: { kind: "workspace_file", path: "index.html" }, supportsCodeEdits: false,
    verification: [{ id: "fixture-check", kind: "canvas_state", description: "Synthetic check" }], tags: ["fixture"],
  });
  return { listScenarios: () => [scenario()], getScenarioById: (id: string) => id === "fixture-scenario" ? scenario() : undefined };
});
beforeAll(async () => {
  fixture.workspaceTemplatePath = await mkdtemp(join(tmpdir(), "cua-manager-template-"));
  await writeFile(join(fixture.workspaceTemplatePath, "index.html"), "<!doctype html><title>Fixture</title>");
});
afterAll(() => rm(fixture.workspaceTemplatePath, { recursive: true, force: true }));

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) =>
      rm(root, { force: true, recursive: true }),
    );
  }
});

async function createManager(stepDelayMs = 10) {
  const root = await mkdtemp(join(tmpdir(), "cua-sample-runner-core-"));
  tempRoots.push(root);

  return {
    dataRoot: root,
    manager: new RunnerManager({
      dataRoot: root,
      stepDelayMs,
      executorFactory: () => ({ execute: async ({ signal }) => waitForAbort(signal) }),
    }),
  };
}

function waitForAbort(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("RunnerManager", () => {
  it("publishes fail-safe cancellation only after execution cleanup finishes", async () => {
    const { dataRoot } = await createManager();
    const cleanup = deferred();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async () => {
      try {
        throw new PythonRuntimeError({ code: "python_failsafe", message: "Desktop fail-safe activated." });
      } finally { await cleanup.promise; }
    } }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    try {
      expect((await manager.getActiveRunDetail())?.run.status).toBe("running");
      cleanup.resolve();
      const cancelled = await manager.waitForRunStatus(started.run.id, "cancelled");
      expect(cancelled.events.filter(event => event.type === "run_cancelled")).toHaveLength(1);
      expect(cancelled.events.some(event => event.type === "run_failed")).toBe(false);
      expect(cancelled.run.summary?.notes).toContain("Desktop fail-safe activated.");
      expect(await manager.getActiveRunDetail()).toBeNull();
    } finally { cleanup.resolve(); await manager.shutdown(); }
  });

  it("reports failed desktop cleanup during Stop and blocks new model execution", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async ({ signal }) => {
      await waitForAbort(signal);
      throw new RunnerCoreError("input_release_failed: permission revoked", { code: "desktop_cleanup_failed" });
    } }) });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const started = await manager.startRun(request);
    const [one, two] = await Promise.all([manager.stopRun(started.run.id), manager.stopRun(started.run.id)]);
    expect(one).toEqual(two);
    expect(one.run.status).toBe("failed");
    expect(one.events.filter(event => event.type === "run_failed")).toHaveLength(1);
    await expect(manager.startRun(request)).rejects.toMatchObject({
      code: "desktop_cleanup_failed", statusCode: 503, hint: expect.stringContaining("restart"),
    });
    await manager.shutdown();
  });

  it("waits for completed execution cleanup before admitting another run", async () => {
    const { dataRoot } = await createManager();
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({
      execute: async (context) => {
        await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
        await cleanup;
      },
    }) });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const started = await manager.startRun(request);
    try {
      expect((await manager.getRunDetail(started.run.id)).run.status).toBe("running");
      expect((await manager.getActiveRunDetail())?.run.id).toBe(started.run.id);
      await expect(manager.startRun(request)).rejects.toMatchObject({ code: "run_already_active" });
      releaseCleanup();
      const completed = await manager.waitForRunStatus(started.run.id, "completed");
      expect(completed.events.filter((event) => event.type === "run_completed")).toHaveLength(1);
      expect(await manager.getActiveRunDetail()).toBeNull();
    } finally {
      releaseCleanup();
      await manager.shutdown();
    }
  });

  it("stops once when Stop and shutdown overlap", async () => {
    const { dataRoot } = await createManager();
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    let cleanedUp = false;
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({
      execute: async ({ signal }) => {
        await waitForAbort(signal);
        await cleanup;
        cleanedUp = true;
      },
    }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    let stopped = false;
    const first = manager.stopRun(started.run.id).then((result) => { stopped = true; return result; });
    const second = manager.stopRun(started.run.id);
    const shutdown = manager.shutdown();
    expect(stopped).toBe(false);
    expect(cleanedUp).toBe(false);
    releaseCleanup();
    const [one, two] = await Promise.all([first, second, shutdown, manager.shutdown()]);
    expect(cleanedUp).toBe(true);
    expect(one).toEqual(two);
    expect(one.events.filter((event) => event.type === "run_cancelled")).toHaveLength(1);
    expect(one.run.status).toBe("cancelled");
  });

  it("reports the admitted run during startup and returns an independent detail snapshot", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({
      execute: async ({ signal }) => waitForAbort(signal),
    }) });
    expect(await manager.getActiveRunDetail()).toBeNull();
    const starting = manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    const [started, active] = await Promise.all([starting, manager.getActiveRunDetail()]);
    expect(active?.run.id).toBe(started.run.id);
    active!.run.prompt = "Mutated client copy";
    active!.events.length = 0;
    expect(await manager.getActiveRunDetail()).toEqual(started);
    await manager.stopRun(started.run.id);
    expect(await manager.getActiveRunDetail()).toBeNull();
  });

  it.each(["completed", "cancelled"] as const)(
    "holds admission through %s persistence and publishes one terminal event when Stop races it",
    async (status) => {
      const { dataRoot } = await createManager();
      const finishExecution = deferred();
      const persisting = deferred();
      const finishPersistence = deferred();
      const manager = new RunnerManager({ dataRoot, executorFactory: () => ({
        execute: async (context) => {
          if (status === "cancelled") await waitForAbort(context.signal);
          else {
            await finishExecution.promise;
            await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
          }
        },
      }) });
      const snapshots = manager as unknown as { writeSnapshot(path: string, contents: string): Promise<void> };
      const writeSnapshot = snapshots.writeSnapshot.bind(manager);
      const writer = vi.spyOn(snapshots, "writeSnapshot").mockImplementation(async (path, contents) => {
        if (JSON.parse(contents).status === status) {
          persisting.resolve();
          await finishPersistence.promise;
        }
        await writeSnapshot(path, contents);
      });
      const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
      const started = await manager.startRun(request);
      const terminalEvents: RunEvent[] = [];
      manager.subscribe(started.run.id, (event) => terminalEvents.push(event));
      try {
        const firstStop = status === "cancelled" ? manager.stopRun(started.run.id) : undefined;
        finishExecution.resolve();
        await persisting.promise;
        expect((await manager.getActiveRunDetail())?.run.status).toBe("running");
        await expect(manager.startRun(request)).rejects.toMatchObject({ code: "run_already_active" });
        let stopped = false;
        const secondStop = manager.stopRun(started.run.id).then((result) => { stopped = true; return result; });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(stopped).toBe(false);
        finishPersistence.resolve();
        const result = await secondStop;
        await firstStop;
        expect(result.run.status).toBe(status);
        expect(terminalEvents.map((event) => event.type)).toEqual([`run_${status}`]);
        expect((await manager.getReplayBundle(started.run.id)).run.status).toBe(status);
        expect(await manager.getActiveRunDetail()).toBeNull();
      } finally {
        finishExecution.resolve();
        finishPersistence.resolve();
        await manager.shutdown();
        writer.mockRestore();
      }
    },
  );

  it.each(["complete", "throw", "cancel"] as const)(
    "keeps a recoverable failed live result when %s cannot be persisted",
    async (outcome) => {
      const { dataRoot } = await createManager();
      const ready = deferred();
      let cleanedUp = false;
      let attempts = 0;
      const manager = new RunnerManager({ dataRoot, executorFactory: () => ({
        execute: async (context) => {
          if (++attempts > 1) {
            await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
            return;
          }
          await ready.promise;
          try {
            if (outcome === "throw") throw new Error("Executor failed");
            if (outcome === "cancel") await waitForAbort(context.signal);
            else await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
          } finally { cleanedUp = true; }
        },
      }) });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
      const started = await manager.startRun(request);
      const received: RunEvent[] = [];
      manager.subscribe(started.run.id, (event) => received.push(event));
      try {
        // A real filesystem failure, including during failRun's own publication.
        const eventsPath = join(dataRoot, "runs", started.run.id, "events.jsonl");
        await rm(eventsPath);
        await mkdir(eventsPath);
        ready.resolve();
        if (outcome === "cancel") await manager.stopRun(started.run.id);
        const failed = await manager.waitForRunStatus(started.run.id, "failed");
        expect(cleanedUp).toBe(true);
        expect(failed.run.summary?.notes.join(" ")).toContain("could not be persisted");
        expect(failed.events.some((event) => event.type === "run_completed")).toBe(false);
        expect(received.map((event) => event.type)).toEqual(["run_failed"]);
        expect(log).toHaveBeenCalled();
        await expect(manager.stopRun(started.run.id)).resolves.toEqual(failed);
        expect(await manager.getActiveRunDetail()).toBeNull();
        // The last durable replay stays intact when storage becomes unusable.
        const restarted = new RunnerManager({ dataRoot });
        expect((await restarted.getRunDetail(started.run.id)).run.status).toBe("running");
        const next = await manager.startRun(request);
        await manager.waitForRunStatus(next.run.id, "completed");
      } finally {
        ready.resolve();
        await manager.shutdown();
        log.mockRestore();
      }
    },
  );

  it("reports cleanup failure during Stop and still permits a fresh run", async () => {
    const { dataRoot } = await createManager();
    let attempt = 0;
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async (context) => {
      if (++attempt === 1) {
        await waitForAbort(context.signal);
        throw new RunnerCoreError("Cleanup failed after Stop", { code: "cleanup_failed" });
      }
      await context.completeRun({ notes: [], outcome: "success", verificationPassed: false });
    } }) });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    try {
      const started = await manager.startRun(request);
      const result = await manager.stopRun(started.run.id);
      expect(result.run.status).toBe("failed");
      expect(result.events.filter((event) => event.type === "run_cancelled")).toHaveLength(0);
      expect(result.run.summary?.notes).toContain("Cleanup failed after Stop");
      const next = await manager.startRun(request);
      await manager.waitForRunStatus(next.run.id, "completed");
    } finally {
      await manager.shutdown();
    }
  });

  it("fails cleanup errors after completion is requested without publishing success", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async (context) => {
      await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
      throw new Error("Browser cleanup failed");
    } }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    const failed = await manager.waitForRunStatus(started.run.id, "failed");
    expect(failed.run.summary?.notes).toContain("Browser cleanup failed");
    expect(failed.events.filter((event) => event.type.startsWith("run_")).map((event) => event.type))
      .toEqual(["run_started", "run_failed"]);
    await manager.shutdown();
  });

  it("fails an executor that returns without completing instead of leaving a stranded run", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async () => {} }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    const failed = await manager.waitForRunStatus(started.run.id, "failed");
    expect(failed.run.summary?.notes).toContain("Executor returned without completing the run.");
    expect(await manager.getActiveRunDetail()).toBeNull();
  });

  it("publishes failure if the final replay write fails after the record and event log were written", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async (context) => {
      await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
    } }) });
    const snapshots = manager as unknown as { writeSnapshot(path: string, contents: string): Promise<void> };
    const writeSnapshot = snapshots.writeSnapshot.bind(manager);
    const writer = vi.spyOn(snapshots, "writeSnapshot").mockImplementation(async (path, contents) => {
      if (path.endsWith("replay.json") && JSON.parse(contents).run.status === "completed") {
        throw new Error("Final replay write failed");
      }
      await writeSnapshot(path, contents);
    });
    try {
      const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
      const failed = await manager.waitForRunStatus(started.run.id, "failed");
      expect(failed.run.summary?.notes).toContain("Final replay write failed");
      expect(failed.events.some((event) => event.type === "run_completed")).toBe(false);
      // The append-only log contains the attempted completion, but reload uses
      // the authoritative replay, which only contains the published failure.
      expect(await readFile(join(dataRoot, "runs", started.run.id, "events.jsonl"), "utf8"))
        .toContain("run_completed");
      const restarted = new RunnerManager({ dataRoot });
      expect(await restarted.getRunDetail(started.run.id)).toEqual(failed);
      expect((await restarted.getReplayBundle(started.run.id)).run.status).toBe("failed");
    } finally { await manager.shutdown(); writer.mockRestore(); }
  });

  it("contains subscriber exceptions so remaining subscribers and execution still complete", async () => {
    const { dataRoot } = await createManager();
    const ready = deferred();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async (context) => {
      await ready.promise;
      await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
    } }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = vi.fn();
    manager.subscribe(started.run.id, () => { throw new Error("Disconnected subscriber"); });
    manager.subscribe(started.run.id, observer);
    try {
      ready.resolve();
      await manager.waitForRunStatus(started.run.id, "completed");
      expect(observer).toHaveBeenCalledWith(expect.objectContaining({ type: "run_completed" }));
      expect(log).toHaveBeenCalled();
    } finally { await manager.shutdown(); log.mockRestore(); }
  });

  it("persists executor construction failures and releases the run slot", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => { throw new Error("Executor setup failed"); } });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const started = await manager.startRun(request);
    await manager.waitForRunStatus(started.run.id, "failed");
    const failure = await manager.stopRun(started.run.id);
    expect(failure.events.filter((event) => event.type === "run_failed")).toHaveLength(1);
    expect(failure.run.summary?.notes).toContain("Executor setup failed");
    const next = await manager.startRun(request);
    expect(next.run.id).not.toBe(started.run.id);
    await manager.shutdown();
  });


  it.each(["code", "native"])("rejects obsolete mode %s before creating a workspace or executor", async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "cua-code-only-"));
    tempRoots.push(root);
    const dataRoot = join(root, "data");
    const executorFactory = vi.fn();
    const manager = new RunnerManager({ dataRoot, executorFactory });
    try {
      await expect(manager.startRun({
        scenarioId: "fixture-scenario", mode, prompt: "Complete fixture.",
      } as never)).rejects.toThrow();
      expect(executorFactory).not.toHaveBeenCalled();
      expect(existsSync(dataRoot)).toBe(false);
    } finally { await manager.shutdown(); }
  });

  it.each(["code", "native"])("reloads historical %s records without obsolete execution fields", async (mode) => {
    const { manager, dataRoot } = await createManager();
    const scenario = { ...listScenarios()[0]!, defaultMode: mode };
    const runId = `legacy-${mode}`;
    const runDirectory = join(dataRoot, "runs", runId);
    const run = {
      id: runId, scenarioId: scenario.id, labId: scenario.labId, mode,
      browserMode: "headless", model: "historical-model", prompt: "Move a card.",
      status: "completed", startedAt: "2026-09-03T00:00:00.000Z",
    };
    const events = [
      ...(mode === "native" ? ["computer_call_requested", "computer_actions_executed", "computer_call_output_recorded"] : ["function_call_requested", "function_call_completed"]),
      "run_completed",
    ].map((type, sequence) => ({
      id: `${runId}:${sequence}`, runId, sequence, type, level: "ok",
      message: type, createdAt: run.startedAt,
    }));
    const browser = {
      currentUrl: "http://127.0.0.1:3102", mode: "headless", screenshots: [],
      targetLabel: "Historical lab", viewport: { width: 1440, height: 900 },
    };
    const replay = { version: 1, run, scenario, events, browser, artifacts: { workspacePath: join(dataRoot, "workspaces", runId) } };
    await mkdir(runDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(runDirectory, "run.json"), JSON.stringify(run)),
      writeFile(join(runDirectory, "replay.json"), JSON.stringify(replay)),
      writeFile(join(runDirectory, "events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n")),
    ]);

    const detail = await manager.getRunDetail(runId);
    const reloadedReplay = await manager.getReplayBundle(runId);
    expect(reloadedReplay.version).toBe(2);
    for (const reloaded of [detail, reloadedReplay]) {
      expect(reloaded.run).not.toHaveProperty("mode");
      expect(reloaded.scenario).not.toHaveProperty("defaultMode");
      expect(reloaded.run.browserMode).toBe("headless");
      expect(reloaded.browser).toEqual(browser);
      expect(reloaded.events).toEqual(events);
    }
    expect(JSON.parse(await readFile(join(runDirectory, "run.json"), "utf8")).mode).toBe(mode);
    const persistedReplay = JSON.parse(await readFile(join(runDirectory, "replay.json"), "utf8"));
    expect(persistedReplay.version).toBe(1);
    expect(persistedReplay.run.mode).toBe(mode);
    expect(persistedReplay.scenario.defaultMode).toBe(mode);
  });

  it("keeps replay snapshots readable while progress is being persisted", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-replay-read-"));
    tempRoots.push(root);
    let begin!: () => void;
    const ready = new Promise<void>((resolve) => { begin = resolve; });
    let finished = false;
    const manager = new RunnerManager({
      dataRoot: root,
      executorFactory: () => ({ execute: async (context) => {
        await ready;
        for (let i = 0; i < 40; i += 1) {
          await context.emitEvent({ type: "run_progress", level: "ok", message: `Step ${i}`, detail: "x".repeat(1024) });
        }
        await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
        finished = true;
      } }),
    });
    const run = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    expect(run.run).not.toHaveProperty("mode");
    expect(run.scenario).not.toHaveProperty("defaultMode");
    expect(run.run.browserMode).toBe("headful");
    const failures: unknown[] = [];
    begin();
    while (!finished) {
      try {
        await manager.getReplayBundle(run.run.id);
      } catch (error) {
        failures.push(error);
      }
    }
    await manager.shutdown();
    expect(failures).toEqual([]);
    const replay = await manager.getReplayBundle(run.run.id);
    expect(replay.run.status).toBe("completed");
    const persistedReplay = JSON.parse(await readFile(join(root, "runs", run.run.id, "replay.json"), "utf8"));
    for (const emittedReplay of [replay, persistedReplay]) {
      expect(emittedReplay.version).toBe(2);
      expect(emittedReplay.run).not.toHaveProperty("mode");
      expect(emittedReplay.scenario).not.toHaveProperty("defaultMode");
    }
  });

  it("accepts only one simultaneous start", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-start-race-"));
    tempRoots.push(root);
    const manager = new RunnerManager({
      dataRoot: root,
      executorFactory: () => ({ execute: async ({ signal }) => {
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      } }),
    });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const results = await Promise.allSettled([manager.startRun(request), manager.startRun(request)]);
    for (const result of results) {
      if (result.status === "fulfilled") await manager.stopRun(result.value.run.id);
    }
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "run_already_active" } });
  });

  it("holds the single-run slot until cancelled execution has cleaned up", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-stop-race-"));
    tempRoots.push(root);
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const manager = new RunnerManager({
      dataRoot: root,
      executorFactory: () => ({ execute: async ({ signal }) => {
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        await cleanup;
      } }),
    });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const run = await manager.startRun(request);
    const stopping = manager.stopRun(run.run.id);
    // The executor intentionally takes time to release its browser/desktop resources.
    const next = await manager.startRun(request).then(() => null, (error: unknown) => error);
    releaseCleanup();
    await stopping;
    expect(next).toMatchObject({ code: "run_already_active" });
  });

  it("rejects run IDs that can escape the data directory", async () => {
    const { manager } = await createManager();
    await expect(manager.getReplayBundle("../../outside")).rejects.toMatchObject({ code: "invalid_run_id" });
    await expect(manager.getRunDetail("../outside")).rejects.toMatchObject({ code: "invalid_run_id" });
  });

  it("shuts down an in-flight start and rejects subsequent runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-shutdown-"));
    tempRoots.push(root);
    let cleanedUp = false;
    const manager = new RunnerManager({
      dataRoot: root,
      executorFactory: () => ({ execute: async ({ signal }) => {
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        cleanedUp = true;
      } }),
    });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const starting = manager.startRun(request);
    await manager.shutdown();
    const run = await starting;
    expect(cleanedUp).toBe(true);
    expect((await manager.getRunDetail(run.run.id)).run.status).toBe("cancelled");
    await expect(manager.startRun(request)).rejects.toMatchObject({ code: "runner_shutting_down" });
  });

  it("defaults to Visible and persists exact model images", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-observation-"));
    tempRoots.push(root);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS7sAAAAASUVORK5CYII=", "base64");
    const manager = new RunnerManager({ dataRoot: root, executorFactory: () => ({ execute: async (context) => {
      const session = {
        mode: "headful", targetLabel: "lab", viewport: { width: 1440, height: 900 },
        readState: async () => ({ currentUrl: "http://127.0.0.1/lab" }),
        captureScreenshot: () => { throw new Error("Model images must not be recaptured"); },
      };
      await context.captureScreenshot(session as never, "model observation", { base64: png.toString("base64"), width: 1, height: 1, source: "code_tool" });
      await context.completeRun({ outcome: "success", notes: [], verificationPassed: true });
    } }) });
    try {
      const run = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
      const detail = await manager.waitForRunStatus(run.run.id, "completed");
      expect(detail.run.browserMode).toBe("headful");
      const artifact = detail.browser!.screenshots[0]!;
      expect(await readFile(artifact.path)).toEqual(png);
      expect(artifact).toMatchObject({ imageWidth: 1, imageHeight: 1, source: "code_tool" });
      expect(detail.browser!.viewport).toEqual({ width: 1440, height: 900 });
      const legacy = { ...artifact };
      delete legacy.source; delete legacy.imageWidth; delete legacy.imageHeight;
      expect(browserScreenshotArtifactSchema.parse(legacy).source).toBeUndefined();
    } finally { await manager.shutdown(); }
  });
});
