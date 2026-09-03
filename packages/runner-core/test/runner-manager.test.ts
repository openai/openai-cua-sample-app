import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

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

describe("RunnerManager", () => {
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
          event.message.includes("live Responses API"),
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
          event.message.includes("live Responses API"),
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
          event.message.includes("live Responses API"),
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
    const { manager } = await createManager(40);

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
    const { manager } = await createManager(50);

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
