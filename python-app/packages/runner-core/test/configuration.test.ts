import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ workspaceTemplatePath: "" }));
vi.mock("@cua-sample/scenario-kit", async () => {
  const actual = await vi.importActual<typeof import("@cua-sample/scenario-kit")>("@cua-sample/scenario-kit");
  const scenario = () => ({
    id: "fixture-scenario", labId: "paint", category: "creativity", title: "Fixture",
    description: "Synthetic configuration test", defaultPrompt: "Complete fixture.",
    workspaceTemplatePath: fixture.workspaceTemplatePath,
    startTarget: { kind: "workspace_file", path: "index.html" }, supportsCodeEdits: false,
    verification: [{ id: "fixture-check", kind: "canvas_state", description: "Synthetic check" }], tags: ["fixture"],
  });
  return { ...actual, listScenarios: () => [scenario()], getScenarioById: (id: string) => id === "fixture-scenario" ? scenario() : undefined };
});
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

it.each([undefined, "custom-runner-model"])("uses runner model %s unless a request overrides it", async (model) => {
  vi.stubEnv("CUA_DEFAULT_MODEL", model);
  vi.resetModules();
  const { RunnerManager } = await import("../src/runner-manager.js");
  const root = await mkdtemp(join(tmpdir(), "cua-model-default-"));
  roots.push(root);
  fixture.workspaceTemplatePath = await mkdtemp(join(tmpdir(), "cua-model-fixture-"));
  roots.push(fixture.workspaceTemplatePath);
  await writeFile(join(fixture.workspaceTemplatePath, "index.html"), "<!doctype html><title>Fixture</title>");
  const manager = new RunnerManager({ dataRoot: root, executorFactory: () => ({
    execute: async (context) => context.completeRun({ notes: [], outcome: "success", verificationPassed: false }),
  }) });
  try {
    const input = { scenarioId: "fixture-scenario", prompt: "Complete fixture." };
    const started = await manager.startRun(input);
    expect(started.run.model).toBe(model ?? "gpt-5.6");
    expect(started.run.maxResponseTurns).toBe(24);
    expect(started.run.verificationEnabled).toBe(false);
    await manager.waitForRunStatus(started.run.id, "completed");
    const explicit = await manager.startRun({ ...input, model: "web-model" });
    expect(explicit.run.model).toBe("web-model");
  } finally {
    await manager.shutdown();
  }
});
