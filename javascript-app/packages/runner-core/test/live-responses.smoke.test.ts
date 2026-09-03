import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { RunnerManager } from "../src/index.js";

const tempRoots: string[] = [];

beforeAll(() => {
  process.env.CUA_RESPONSES_MODE = "live";

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY must be set to run packages/runner-core/test/live-responses.smoke.test.ts",
    );
  }
});

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

async function createLiveManager(stepDelayMs = 10) {
  const dataRoot = await mkdtemp(join(tmpdir(), "cua-sample-live-smoke-"));
  tempRoots.push(dataRoot);

  return new RunnerManager({
    dataRoot,
    stepDelayMs,
  });
}

async function waitForTerminalRun(
  manager: RunnerManager,
  runId: string,
  timeoutMs = 120_000,
) {
  const finalStatuses = new Set(["completed", "failed", "cancelled"]);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await manager.getRunDetail(runId);

    if (finalStatuses.has(detail.run.status)) {
      return detail;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for run ${runId} to reach a terminal status.`);
}

describe("live Responses smoke", () => {
  it(
    "completes the kanban code path against the live Responses API",
    async () => {
      const manager = await createLiveManager();
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
        verificationEnabled: true,
      });

      const completed = await waitForTerminalRun(manager, detail.run.id);

      const runNotes = completed.run.summary?.notes.join("\n");
      expect(completed.run.status, runNotes).toBe("completed");
      expect(completed.run.summary?.verificationPassed, runNotes).toBe(true);
    },
    130_000,
  );

  it.each(["headless", "headful"] as const)(
    "completes the paint code path against the live Responses API (%s)",
    async (browserMode) => {
      const manager = await createLiveManager();
      const detail = await manager.startRun({
        browserMode,
        prompt:
          "Draw a yellow smiley face with black eyes and a curved smile, then save the draft.",
        scenarioId: "paint-draw-poster",
        verificationEnabled: true,
      });

      const completed = await waitForTerminalRun(manager, detail.run.id);

      const runNotes = completed.run.summary?.notes.join("\n");
      expect(completed.run.status, runNotes).toBe("completed");
      expect(completed.run.summary?.verificationPassed, runNotes).toBe(true);
    },
    130_000,
  );

  it(
    "completes the booking code path against the live Responses API",
    async () => {
      const manager = await createLiveManager();
      const detail = await manager.startRun({
        browserMode: "headless",
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
        verificationEnabled: true,
      });

      const completed = await waitForTerminalRun(manager, detail.run.id);

      const runNotes = completed.run.summary?.notes.join("\n");
      expect(completed.run.status, runNotes).toBe("completed");
      expect(completed.run.summary?.verificationPassed, runNotes).toBe(true);
    },
    130_000,
  );
});
