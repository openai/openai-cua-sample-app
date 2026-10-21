import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunnerManager } from "../src/runner-manager.js";

const fixture = vi.hoisted(() => ({ template: "", changed: false, removed: false }));
vi.mock("../src/executor-registry.js", () => ({
  createDefaultRunExecutor: () => { throw new Error("Tests must provide an executor."); },
}));
vi.mock("../src/lab-catalog.js", () => ({
  getScenarioById: (id: string) => !fixture.removed && id === "saved-scenario" ? {
    id, labId: "paint", category: "creativity",
    title: fixture.changed ? "Changed title" : "Original title",
    description: fixture.changed ? "Changed description" : "Original description",
    defaultPrompt: fixture.changed ? "Different task" : "Complete original task.",
    tags: [fixture.changed ? "changed" : "original"], workspaceTemplatePath: fixture.template,
  } : undefined,
}));
beforeAll(async () => {
  fixture.template = await mkdtemp(join(tmpdir(), "cua-replay-template-"));
  await writeFile(join(fixture.template, "index.html"), "Synthetic replay test");
});
afterAll(() => rm(fixture.template, { recursive: true, force: true }));

function manager(root: string) {
  return new RunnerManager({ dataRoot: root, executorFactory: () => ({
    execute: async ({ signal }) => new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    }),
  }) });
}

describe("saved scenario metadata", () => {
  it.each(["modified", "removed", "unchanged"])("survives a %s scenario catalog", async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "cua-replay-scenario-"));
    const original = manager(root);
    const reopened = manager(root);
    fixture.changed = false;
    fixture.removed = false;
    try {
      const started = await original.startRun({ scenarioId: "saved-scenario", prompt: "Complete task." });
      const final = await original.stopRun(started.run.id);
      const replay = await original.getReplayBundle(started.run.id);
      fixture.changed = mode === "modified";
      fixture.removed = mode === "removed";
      const loaded = await reopened.getRunDetail(started.run.id);
      expect(loaded.scenario).toEqual(final.scenario);
      expect(loaded.run).toEqual(final.run);
      expect(loaded.events).toEqual(final.events);
      loaded.scenario.tags.push("local mutation");
      expect((await reopened.getRunDetail(started.run.id)).scenario).toEqual(replay.scenario);
      expect((await reopened.stopRun(started.run.id)).scenario).toEqual(replay.scenario);
      if (fixture.removed) {
        await expect(reopened.startRun({ scenarioId: "saved-scenario", prompt: "Complete task." })).rejects.toMatchObject({ code: "unknown_scenario" });
      }
    } finally {
      await original.shutdown();
      await reopened.shutdown();
      fixture.changed = false;
      fixture.removed = false;
      await rm(root, { recursive: true, force: true });
    }
  });
});
