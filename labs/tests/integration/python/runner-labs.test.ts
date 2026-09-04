import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunnerManager } from "@app/runner-core/index";
import { type RunEvent } from "@cua-sample/replay-schema";
const tempRoots: string[] = [];
afterEach(async () => { for (const root of tempRoots.splice(0)) await rm(root, { force: true, recursive: true }); });
async function createManager(stepDelayMs = 10) {
  const dataRoot = await mkdtemp(join(tmpdir(), "lab-manager-test-")); tempRoots.push(dataRoot);
  return { dataRoot, manager: new RunnerManager({ dataRoot, stepDelayMs }) };
}

describe("runner lab integration", () => {
  it("fails the kanban code executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headful",
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

    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("fails the paint code executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headful",
      maxResponseTurns: 18,
      prompt: "Paint me a smiley face as simple pixel art and save the draft.",
      scenarioId: "paint-draw-poster",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("fails the booking code executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headful",
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

    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.detail?.includes("live Responses API"),
      ),
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
    expect(existsSync(join(state.workspacePath, "README.md"))).toBe(true);
  });
});
