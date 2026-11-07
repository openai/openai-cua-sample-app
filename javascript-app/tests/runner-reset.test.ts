import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RunnerManager } from "../src/runner-manager.js";

const fixtures = vi.hoisted(() => ({ template: "" }));
vi.mock("../src/executor-registry.js", () => ({ createDefaultRunExecutor: () => { throw new Error("Use the synthetic executor."); } }));
vi.mock("../src/lab-catalog.js", () => ({
  getScenarioById: (id: string) => ["fixture-a", "fixture-b"].includes(id) ? {
    id, labId: "paint", category: "creativity", title: "Fixture",
    description: "Synthetic reset test", defaultPrompt: "Complete fixture.",
    workspaceTemplatePath: fixtures.template, tags: ["fixture"],
  } : undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, cp: vi.fn(actual.cp) };
});
const workspaces: string[] = [];
beforeAll(async () => {
  fixtures.template = await mkdtemp(join(tmpdir(), "cua-reset-template-"));
  await writeFile(join(fixtures.template, "index.html"), "Synthetic fixture.");
});
afterAll(() => rm(fixtures.template, { recursive: true, force: true }));
afterEach(async () => {
  vi.mocked(cp).mockReset();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(cp).mockImplementation(actual.cp);
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function waitForAbort(signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
async function fixture(failPreparation = false) {
  const root = await mkdtemp(join(tmpdir(), "cua-reset-"));
  workspaces.push(root);
  const entered = deferred(), release = deferred();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(cp).mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    if (failPreparation) throw new Error("Synthetic copy failure");
    await actual.cp(...args);
  });
  const cleanupEntered = deferred(), cleanupRelease = deferred();
  const manager = new RunnerManager({
    dataRoot: root,
    executorFactory: () => ({ execute: async ({ signal }) => {
      await waitForAbort(signal);
      cleanupEntered.resolve();
      await cleanupRelease.promise;
    } }),
  });
  return { root, manager, entered, release, cleanupEntered, cleanupRelease };
}

describe("reset during run startup", () => {
  it("cancels the admitted run and waits for its cleanup before acknowledging reset", async () => {
    const f = await fixture();
    const starting = f.manager.startRun({ scenarioId: "fixture-a", prompt: "Complete fixture." });
    try {
      await f.entered.promise;
      let acknowledged = false;
      const reset = f.manager.resetScenario("fixture-a").then(value => { acknowledged = true; return value; });
      f.release.resolve();
      const started = await starting;
      const first = await Promise.race([
        reset.then(() => "acknowledged"),
        f.cleanupEntered.promise.then(() => "cleanup"),
      ]);
      expect(first).toBe("cleanup");
      expect(acknowledged).toBe(false);
      f.cleanupRelease.resolve();
      expect(await reset).toMatchObject({ cancelledRunId: started.run.id });
      expect(await f.manager.getActiveRunDetail()).toBeNull();
      const replay = JSON.parse(await readFile(join(f.root, "runs", started.run.id, "replay.json"), "utf8"));
      expect(replay.run.status).toBe("cancelled");
      expect(replay.events.filter((event: { type: string }) => event.type === "run_cancelled")).toHaveLength(1);
    } finally {
      f.release.resolve(); f.cleanupRelease.resolve();
      await starting.catch(() => {});
      await f.manager.shutdown();
    }
  });

  it("leaves a starting run for another scenario active", async () => {
    const f = await fixture();
    const starting = f.manager.startRun({ scenarioId: "fixture-a", prompt: "Complete fixture." });
    try {
      await f.entered.promise;
      const reset = f.manager.resetScenario("fixture-b");
      f.release.resolve();
      const started = await starting;
      expect((await reset).cancelledRunId).toBeUndefined();
      expect((await f.manager.getActiveRunDetail())?.run.id).toBe(started.run.id);
    } finally { f.release.resolve(); f.cleanupRelease.resolve(); await f.manager.shutdown(); }
  });

  it("finishes reset when preparation fails without creating a run", async () => {
    const f = await fixture(true);
    const starting = f.manager.startRun({ scenarioId: "fixture-a", prompt: "Complete fixture." }).catch(error => error);
    try {
      await f.entered.promise;
      const reset = f.manager.resetScenario("fixture-a");
      f.release.resolve();
      expect(await starting).toMatchObject({ message: "Synthetic copy failure" });
      expect((await reset).cancelledRunId).toBeUndefined();
      expect(await f.manager.getActiveRunDetail()).toBeNull();
    } finally { f.release.resolve(); f.cleanupRelease.resolve(); await f.manager.shutdown(); }
  });
});
