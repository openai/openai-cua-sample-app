import type { ScenarioManifest } from "@cua-sample/replay-schema";

export const scenarioFixture: ScenarioManifest = {
  id: "demo-scenario", labId: "kanban", category: "productivity",
  title: "Demo App", description: "A generic test scenario.", defaultPrompt: "Complete the demo task.",
  workspaceTemplatePath: "/tmp/demo-template", supportsCodeEdits: false, tags: ["test"],
  startTarget: { kind: "remote_url", label: "Demo page", url: "http://127.0.0.1:3102" },
  verification: [{ id: "demo-check", kind: "board_state", description: "Check the demo result." }],
};
