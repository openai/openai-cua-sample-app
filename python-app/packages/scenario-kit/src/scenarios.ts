import { fileURLToPath } from "node:url";

import {
  scenarioManifestSchema,
  type ScenarioCategory,
  type ScenarioManifest,
} from "@cua-sample/replay-schema";

import { labCatalog } from "./lab-data.js";

const templatePath = (labDirectory: string) =>
  fileURLToPath(new URL(`../../../../labs/${labDirectory}`, import.meta.url));

const scenarioCatalog = scenarioManifestSchema.array().parse(
  labCatalog.scenarios.map(({ templateDirectory, ...scenario }) => ({
    ...scenario, workspaceTemplatePath: templatePath(templateDirectory),
  })),
);

export const heroScenarioIds = scenarioCatalog
  .filter((scenario) => scenario.tags.includes("hero"))
  .map((scenario) => scenario.id);

export function listScenarios(): ScenarioManifest[] {
  return scenarioCatalog.map((scenario) => ({
    ...scenario,
    verification: scenario.verification.map((check) => ({ ...check })),
    tags: [...scenario.tags],
  }));
}

export function getScenarioById(id: string): ScenarioManifest | undefined {
  return listScenarios().find((scenario) => scenario.id === id);
}

export function getScenarioCategories(): ScenarioCategory[] {
  const categories = new Set<ScenarioCategory>();

  for (const scenario of listScenarios()) {
    categories.add(scenario.category);
  }

  return [...categories];
}
