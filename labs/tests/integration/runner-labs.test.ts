import { waitForRunStatus } from "../../../javascript-app/tests/support.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunnerManager } from "../../../javascript-app/src/runner-manager.js";
import { type RunEvent } from "@cua-sample/contracts";
const tempRoots: string[] = [];
afterEach(async () => { for (const root of tempRoots.splice(0)) await rm(root, { force: true, recursive: true }); });
async function createManager() {
  const dataRoot = await mkdtemp(join(tmpdir(), "lab-manager-test-")); tempRoots.push(dataRoot);
  return { dataRoot, manager: new RunnerManager({ dataRoot }) };
}
function waitForAbort(signal: AbortSignal) {
  return new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
}

describe("runner lab integration", () => {
  it("fails the kanban executor honestly when the API key is missing", async () => {
    const { manager } = await createManager();

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      prompt: "Inspect the interface, then finish.",
      scenarioId: "kanban-reprioritize-sprint",
    });

    const failed = await waitForRunStatus(manager, detail.run.id, "failed");

    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("OPENAI_API_KEY"),
      ),
    ).toBe(true);
  });

  it("fails the paint executor honestly when the API key is missing", async () => {
    const { manager } = await createManager();

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      prompt: "Paint me a smiley face as simple pixel art and save the draft.",
      scenarioId: "paint-draw-poster",
    });

    const failed = await waitForRunStatus(manager, detail.run.id, "failed");

    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("OPENAI_API_KEY"),
      ),
    ).toBe(true);
  });

  it("fails the booking executor honestly when the API key is missing", async () => {
    const { manager } = await createManager();

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      prompt: "Inspect the interface, then finish.",
      scenarioId: "booking-complete-reservation",
    });

    const failed = await waitForRunStatus(manager, detail.run.id, "failed");

    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("OPENAI_API_KEY"),
      ),
    ).toBe(true);
  });

  it("resets a scenario and cancels its active run", async () => {
    const { dataRoot } = await createManager();
    const manager = new RunnerManager({ dataRoot, executorFactory: () => ({ execute: async ({ signal }) => waitForAbort(signal) }) });

    const detail = await manager.startRun({
      browserMode: "headful",
      prompt: "Inspect the interface, then finish.",
      scenarioId: "booking-complete-reservation",
    });

    const state = await manager.resetScenario("booking-complete-reservation");
    const cancelled = await manager.getRunDetail(detail.run.id);

    expect(cancelled.run.status).toBe("cancelled");
    expect(state.cancelledRunId).toBe(detail.run.id);
    expect(state.scenarioId).toBe("booking-complete-reservation");
  });
});
