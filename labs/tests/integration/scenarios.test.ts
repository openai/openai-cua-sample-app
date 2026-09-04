import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { scenarioManifestSchema } from "@cua-sample/contracts";

import { listScenarios } from "../../../javascript-app/src/lab-catalog.js";

describe("scenario registry", () => {
  it("loads the three lab scenarios", () => {
    const scenarios = listScenarios();

    expect(scenarios).toHaveLength(3);
    expect(new Set(scenarios.map((scenario) => scenario.labId))).toEqual(
      new Set(["kanban", "paint", "booking"]),
    );

    for (const scenario of scenarios) {
      expect(() => scenarioManifestSchema.parse(scenario)).not.toThrow();
      expect(existsSync(scenario.workspaceTemplatePath)).toBe(true);
    }
  });
});
