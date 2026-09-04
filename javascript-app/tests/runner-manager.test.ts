import { waitForRunStatus } from "./support.js";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RunEvent } from "@cua-sample/contracts";

import { RunnerManager } from "../src/runner-manager.js";

const tempRoots: string[] = [];
vi.mock("../src/executor-registry.js", () => ({
  createDefaultRunExecutor: () => { throw new Error("Generic manager tests must provide an executor."); },
}));
const fixture = vi.hoisted(() => ({ workspaceTemplatePath: "" }));
vi.mock("../src/lab-catalog.js", () => {
  const scenario = () => ({
    id: "fixture-scenario", labId: "paint", category: "creativity", title: "Fixture",
    description: "Synthetic runner test", defaultPrompt: "Complete fixture.",
    workspaceTemplatePath: fixture.workspaceTemplatePath,
    tags: ["fixture"],
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
    await rm(root, { force: true, recursive: true });
  }
});

async function createManager() {
  const root = await mkdtemp(join(tmpdir(), "cua-runner-"));
  tempRoots.push(root);

  return {
    dataRoot: root,
    manager: new RunnerManager({
      dataRoot: root,
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
  it("rejects unknown fields before creating a workspace or executor", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-code-only-"));
    tempRoots.push(root);
    const dataRoot = join(root, "data");
    const executorFactory = vi.fn();
    const manager = new RunnerManager({ dataRoot, executorFactory });
    try {
      await expect(manager.startRun({
        scenarioId: "fixture-scenario", unexpected: true, prompt: "Complete fixture.",
      } as never)).rejects.toThrow();
      expect(executorFactory).not.toHaveBeenCalled();
      expect(existsSync(dataRoot)).toBe(false);
    } finally { await manager.shutdown(); }
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
        await context.completeRun({ notes: []});
        finished = true;
      } }),
    });
    const run = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    expect(run.run.browserMode).toBe("headless");
    const failures: unknown[] = [];
    begin();
    while (!finished) {
      try {
        await manager.getReplayBundle(run.run.id);
      } catch (error) {
        failures.push(error);
      }
    }
    await waitForRunStatus(manager, run.run.id, "completed");
    await manager.shutdown();
    expect(failures).toEqual([]);
    const replay = await manager.getReplayBundle(run.run.id);
    expect(replay.run.status).toBe("completed");
    const persistedReplay = JSON.parse(await readFile(join(root, "runs", run.run.id, "replay.json"), "utf8"));
    for (const emittedReplay of [replay, persistedReplay]) {
      expect(emittedReplay.version).toBe(3);
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
    // The executor intentionally takes time to release its browser resources.
    const next = await manager.startRun(request).then(() => null, (error: unknown) => error);
    releaseCleanup();
    await stopping;
    expect(next).toMatchObject({ code: "run_already_active" });
  });

  it("rejects run IDs that can escape the data directory", async () => {
    const { manager } = await createManager();
    await expect(manager.getReplayBundle("../../outside")).rejects.toMatchObject({ code: "invalid_run_id" });
    await expect(manager.getRunDetail("../outside")).rejects.toMatchObject({ code: "invalid_run_id" });
    await expect(manager.stopRun("../outside")).rejects.toMatchObject({ code: "invalid_run_id" });
    expect(() => manager.subscribe("../outside", () => undefined)).toThrow("Invalid run ID");
  });

  it("waits for completed execution cleanup before admitting another run", async () => {
    const { dataRoot } = await createManager();
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({
      execute: async (context) => {
        await context.completeRun({ notes: []});
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
      const completed = await waitForRunStatus(manager, started.run.id, "completed");
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
            await context.completeRun({ notes: []});
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
            await context.completeRun({ notes: []});
            return;
          }
          await ready.promise;
          try {
            if (outcome === "throw") throw new Error("Executor failed");
            if (outcome === "cancel") await waitForAbort(context.signal);
            else await context.completeRun({ notes: []});
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
        const failed = await waitForRunStatus(manager, started.run.id, "failed");
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
        await waitForRunStatus(manager, next.run.id, "completed");
      } finally {
        ready.resolve();
        await manager.shutdown();
        log.mockRestore();
      }
    },
  );

  it("fails cleanup errors after completion is requested without publishing success", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async (context) => {
      await context.completeRun({ notes: []});
      throw new Error("Browser cleanup failed");
    } }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    const failed = await waitForRunStatus(manager, started.run.id, "failed");
    expect(failed.run.summary?.notes).toContain("Browser cleanup failed");
    expect(failed.events.filter((event) => event.type.startsWith("run_")).map((event) => event.type))
      .toEqual(["run_started", "run_failed"]);
    await manager.shutdown();
  });

  it("fails an executor that returns without completing instead of leaving a stranded run", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async () => {} }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    const failed = await waitForRunStatus(manager, started.run.id, "failed");
    expect(failed.run.summary?.notes).toContain("Executor returned without completing the run.");
    expect(await manager.getActiveRunDetail()).toBeNull();
  });

  it("publishes failure if the final replay write fails after the record and event log were written", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async (context) => {
      await context.completeRun({ notes: []});
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
      const failed = await waitForRunStatus(manager, started.run.id, "failed");
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
      await context.completeRun({ notes: []});
    } }) });
    const started = await manager.startRun({ scenarioId: "fixture-scenario", prompt: "Complete fixture." });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = vi.fn();
    manager.subscribe(started.run.id, () => { throw new Error("Disconnected subscriber"); });
    manager.subscribe(started.run.id, observer);
    try {
      ready.resolve();
      await waitForRunStatus(manager, started.run.id, "completed");
      expect(observer).toHaveBeenCalledWith(expect.objectContaining({ type: "run_completed" }));
      expect(log).toHaveBeenCalled();
    } finally { await manager.shutdown(); log.mockRestore(); }
  });

  it("persists executor construction failures and releases the run slot", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => { throw new Error("Executor setup failed"); } });
    const request = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const started = await manager.startRun(request);
    await waitForRunStatus(manager, started.run.id, "failed");
    const failure = await manager.stopRun(started.run.id);
    expect(failure.events.filter((event) => event.type === "run_failed")).toHaveLength(1);
    expect(failure.run.summary?.notes).toContain("Executor setup failed");
    const next = await manager.startRun(request);
    expect(next.run.id).not.toBe(started.run.id);
    await manager.shutdown();
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

  it("reloads a completed run and its replay", async () => {
    const { dataRoot } = await createManager();
    let finishExecution = () => {};
    const executionFinished = new Promise<void>((resolveExecution) => {
      finishExecution = resolveExecution;
    });
    const manager = new RunnerManager({
      dataRoot,
      executorFactory: () => ({
        async execute(context) {
          await context.emitEvent({
            detail: "exec_js",
            level: "ok",
            message: "Function tool call completed.",
            type: "function_call_completed",
          });
          await context.completeRun({
            notes: ["Browser task completed."],
          });
          finishExecution();
        },
      }),
    });

    const started = await manager.startRun({
      browserMode: "headless",
      prompt: "Complete the synthetic fixture, then finish.",
      scenarioId: "fixture-scenario",
    });
    await executionFinished;
    await waitForRunStatus(manager, started.run.id, "completed");

    const completed = await manager.getRunDetail(started.run.id);
    const restartedManager = new RunnerManager({ dataRoot });
    const reloaded = await restartedManager.getRunDetail(started.run.id);
    const replay = await restartedManager.getReplayBundle(started.run.id);
    const persistedRun = JSON.parse(
      await readFile(join(dataRoot, "runs", started.run.id, "run.json"), "utf8"),
    );

    expect(completed.run.status).toBe("completed");
    expect(completed.run.model).toBe("gpt-5.6-sol");
    expect(completed.run.maxResponseTurns).toBe(24);
    expect(reloaded).toEqual(completed);
    expect(replay.version).toBe(3);
    expect(replay.run).not.toHaveProperty("verificationEnabled");
    expect(replay.run.summary).toEqual({
      notes: ["Browser task completed."],
      screenshotCount: 0,
      stepCount: replay.events.length,
    });
    expect(replay.scenario).not.toHaveProperty("verification");
    expect(replay.run).toEqual(completed.run);
    expect(replay.events).toEqual(completed.events);
    expect(replay.scenario).toEqual(completed.scenario);
    expect(persistedRun).toEqual(completed.run);
    expect(reloaded.events.some((event) => event.type === "function_call_completed")).toBe(true);
  });

});
