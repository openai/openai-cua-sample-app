import { fileURLToPath } from "node:url";

import { scenarioManifestSchema, type ScenarioManifest } from "@cua-sample/contracts";
import catalog from "../../labs/catalog.json" with { type: "json" };

const labsRoot = new URL("../../labs/", import.meta.url);
const scenarios = scenarioManifestSchema.array().parse(
  catalog.scenarios.map(({ templateDirectory, ...scenario }) => ({
    ...scenario,
    workspaceTemplatePath: fileURLToPath(new URL(templateDirectory, labsRoot)),
  })),
);

export function listScenarios(): ScenarioManifest[] {
  return structuredClone(scenarios);
}

export function getScenarioById(id: string): ScenarioManifest | undefined {
  return listScenarios().find(scenario => scenario.id === id);
}

export function getLabInstructions(labId: string): string[] {
  const definition = catalog.scenarios.find(scenario => scenario.labId === labId);
  if (!definition) throw new Error(`Unknown lab: ${labId}`);
  return [...definition.instructions];
}
