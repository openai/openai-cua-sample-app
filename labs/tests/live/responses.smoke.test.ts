import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { RunnerManager } from "../../../javascript-app/src/runner-manager.js";

const tempRoots: string[] = [];
const managers: RunnerManager[] = [];

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY must be set to run labs/tests/live/responses.smoke.test.ts",
    );
  }
});

afterEach(async () => {
  // Stop any run still active after an assertion or test timeout before removing its files.
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  for (const root of tempRoots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

async function createLiveManager() {
  const dataRoot = await mkdtemp(join(tmpdir(), "cua-sample-live-smoke-"));
  tempRoots.push(dataRoot);

  const manager = new RunnerManager({
    dataRoot,
  });
  managers.push(manager);
  return manager;
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

// These opt-in checks cover the API/tool lifecycle and retained files, not task grading.
describe("live Responses smoke", () => {
  it(
    "completes the kanban code path against the live Responses API",
    async () => {
      const manager = await createLiveManager();
      const detail = await manager.startRun({
        browserMode: "headless",
        prompt: "Move all cards into Done and report when finished.",
        scenarioId: "kanban-reprioritize-sprint",
      });

      const completed = await waitForTerminalRun(manager, detail.run.id);

      const runNotes = completed.run.summary?.notes.join("\n");
      expect(completed.run.status, runNotes).toBe("completed");
      expect(completed.events.some(event => event.type === "function_call_completed")).toBe(true);
      expect(completed.browser?.screenshots.at(-1)?.label).toBe(`${completed.run.labId}-final`);
      expect((await manager.getReplayBundle(detail.run.id)).version).toBe(3);
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
      });

      const completed = await waitForTerminalRun(manager, detail.run.id);

      const runNotes = completed.run.summary?.notes.join("\n");
      expect(completed.run.status, runNotes).toBe("completed");
      expect(completed.events.some(event => event.type === "function_call_completed")).toBe(true);
      expect(completed.browser?.screenshots.at(-1)?.label).toBe(`${completed.run.labId}-final`);
      expect((await manager.getReplayBundle(detail.run.id)).version).toBe(3);
    },
    130_000,
  );

  it(
    "completes the booking code path against the live Responses API",
    async () => {
      const manager = await createLiveManager();
      const detail = await manager.startRun({
        browserMode: "headless",
        prompt: "Book the Luma Harbor Hotel from April 18 to April 21, 2026 for Ada Lovelace (ada.lovelace@example.com), including breakfast and a workspace. Request a late arrival after 9pm.",
        scenarioId: "booking-complete-reservation",
      });

      const completed = await waitForTerminalRun(manager, detail.run.id);

      const runNotes = completed.run.summary?.notes.join("\n");
      expect(completed.run.status, runNotes).toBe("completed");
      expect(completed.events.some(event => event.type === "function_call_completed")).toBe(true);
      expect(completed.browser?.screenshots.at(-1)?.label).toBe(`${completed.run.labId}-final`);
      expect((await manager.getReplayBundle(detail.run.id)).version).toBe(3);
    },
    130_000,
  );
});
