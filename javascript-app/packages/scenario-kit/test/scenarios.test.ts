import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { scenarioManifestSchema } from "@cua-sample/replay-schema";

import { listScenarios } from "../src/index.js";

describe("scenario registry", () => {
  it("loads only the prompt-driven scenarios that are still enabled", () => {
    const scenarios = listScenarios();

    expect(scenarios).toHaveLength(3);
    expect(new Set(scenarios.map((scenario) => scenario.labId))).toEqual(
      new Set(["kanban", "paint", "booking"]),
    );

    for (const scenario of scenarios) {
      expect(() => scenarioManifestSchema.parse(scenario)).not.toThrow();
      expect(existsSync(scenario.workspaceTemplatePath)).toBe(true);
      expect(scenario).not.toHaveProperty("defaultMode");
    }
  });
});
