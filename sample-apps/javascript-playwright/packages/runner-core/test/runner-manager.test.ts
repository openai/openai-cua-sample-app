import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunEvent } from "@cua-sample/replay-schema";

import { RunnerManager } from "../src/index.js";

const tempRoots: string[] = [];

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
    }),
  };
}

function waitForAbort(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("RunnerManager", () => {
  it.each(["code", "native"])("rejects obsolete mode %s before creating a workspace or executor", async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "cua-code-only-"));
    tempRoots.push(root);
    const dataRoot = join(root, "data");
    const executorFactory = vi.fn();
    const manager = new RunnerManager({ dataRoot, executorFactory });
    try {
      await expect(manager.startRun({
        scenarioId: "paint-draw-poster", mode, prompt: "Draw a circle.",
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
        await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
        finished = true;
      } }),
    });
    const run = await manager.startRun({ scenarioId: "paint-draw-poster", prompt: "Draw a circle." });
    expect(run.run).not.toHaveProperty("mode");
    expect(run.scenario).not.toHaveProperty("defaultMode");
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
    const request = { scenarioId: "paint-draw-poster", prompt: "Draw a circle." };
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
    const request = { scenarioId: "paint-draw-poster", prompt: "Draw a circle." };
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
        await context.completeRun({ notes: [], outcome: "success", verificationPassed: true });
        await cleanup;
      },
    }) });
    const request = { scenarioId: "paint-draw-poster", prompt: "Draw a circle." };
    const started = await manager.startRun(request);
    try {
      await manager.waitForRunStatus(started.run.id, "completed");
      await expect(manager.startRun(request)).rejects.toMatchObject({ code: "run_already_active" });
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
    const started = await manager.startRun({ scenarioId: "paint-draw-poster", prompt: "Draw a circle." });
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

  it("persists executor construction failures and releases the run slot", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => { throw new Error("Executor setup failed"); } });
    const request = { scenarioId: "paint-draw-poster", prompt: "Draw a circle." };
    const started = await manager.startRun(request);
    await manager.waitForRunStatus(started.run.id, "failed");
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
    const request = { scenarioId: "paint-draw-poster", prompt: "Draw a circle." };
    const starting = manager.startRun(request);
    await manager.shutdown();
    const run = await starting;
    expect(cleanedUp).toBe(true);
    expect((await manager.getRunDetail(run.run.id)).run.status).toBe("cancelled");
    await expect(manager.startRun(request)).rejects.toMatchObject({ code: "runner_shutting_down" });
  });

  it("fails the kanban executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      prompt: [
        "Reorganize the board to match this requested final board state exactly.",
        "",
        "backlog: Refresh workspace docs",
        "in_progress: Close nav bug triage -> Finalize analytics spec",
        "done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips",
      ].join("\n"),
      scenarioId: "kanban-reprioritize-sprint",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("fails the paint executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      prompt: "Paint me a smiley face as simple pixel art and save the draft.",
      scenarioId: "paint-draw-poster",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("fails the booking executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      prompt: [
        "Complete the reservation flow using only the request below.",
        "",
        "hotel: Luma Harbor Hotel",
        "neighborhood: Marina District",
        "check_in: 2026-04-18",
        "check_out: 2026-04-21",
        "guest_name: Ada Lovelace",
        "guest_email: ada.lovelace@example.com",
        "requires: breakfast included, workspace desk",
        "special_request: Late arrival after 9pm.",
      ].join("\n"),
      scenarioId: "booking-complete-reservation",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("reloads a completed run and its version-2 replay without execution-mode metadata", async () => {
    const { dataRoot } = await createManager(0);
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
            outcome: "success",
            verificationPassed: true,
          });
          finishExecution();
        },
      }),
      stepDelayMs: 0,
    });

    const started = await manager.startRun({
      browserMode: "headless",
      prompt: "Paint a smiley face and save the draft.",
      scenarioId: "paint-draw-poster",
      verificationEnabled: true,
    });
    await executionFinished;

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
    expect(replay.version).toBe(2);
    expect(replay.run).toEqual(completed.run);
    expect(replay.events).toEqual(completed.events);
    expect(replay.scenario).toEqual(completed.scenario);
    expect(persistedRun).toEqual(completed.run);
    expect(persistedRun).not.toHaveProperty("mode");
    expect(replay.scenario).not.toHaveProperty("defaultMode");
    expect(reloaded.events.some((event) => event.type === "function_call_completed")).toBe(true);
  });

  it("cancels a running run", async () => {
    const { dataRoot } = await createManager(40);
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async ({ signal }) => waitForAbort(signal) }) });

    const detail = await manager.startRun({
      browserMode: "headless",
      prompt: [
        "Reorganize the board to match this requested final board state exactly.",
        "",
        "backlog: Refresh workspace docs",
        "in_progress: Close nav bug triage -> Finalize analytics spec",
        "done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips",
      ].join("\n"),
      scenarioId: "kanban-reprioritize-sprint",
    });

    const cancelled = await manager.stopRun(detail.run.id, "Stop button pressed.");

    expect(cancelled.run.status).toBe("cancelled");
    expect(
      cancelled.events.some((event: RunEvent) => event.type === "run_cancelled"),
    ).toBe(true);
  });

  it("resets a scenario workspace and cancels the active run for that scenario", async () => {
    const { dataRoot } = await createManager(50);
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async ({ signal }) => waitForAbort(signal) }) });

    const detail = await manager.startRun({
      browserMode: "headful",
      prompt: [
        "Complete the reservation flow using only the request below.",
        "",
        "hotel: Luma Harbor Hotel",
        "neighborhood: Marina District",
        "check_in: 2026-04-18",
        "check_out: 2026-04-21",
        "guest_name: Ada Lovelace",
        "guest_email: ada.lovelace@example.com",
        "requires: breakfast included, workspace desk",
        "special_request: Late arrival after 9pm.",
      ].join("\n"),
      scenarioId: "booking-complete-reservation",
    });

    const state = await manager.resetScenario("booking-complete-reservation");
    const cancelled = await manager.getRunDetail(detail.run.id);

    expect(cancelled.run.status).toBe("cancelled");
    expect(state.cancelledRunId).toBe(detail.run.id);
    expect(existsSync(state.workspacePath)).toBe(true);
    expect(existsSync(join(state.workspacePath, "README.md"))).toBe(true);
  });
});
