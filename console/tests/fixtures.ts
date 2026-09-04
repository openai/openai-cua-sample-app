import type { BackendCapabilities, ScenarioManifest } from "@cua-sample/contracts";

export const scenarioFixture: ScenarioManifest = {
  id: "demo-scenario", labId: "kanban", category: "productivity",
  title: "Demo App", description: "A generic test scenario.", defaultPrompt: "Complete the demo task.",
  workspaceTemplatePath: "/tmp/demo-template", tags: ["test"],
};

export const javascriptCapabilities: BackendCapabilities = {
  instanceId: "javascript-test-instance",
  backendId: "javascript", codeTool: "exec_js", browserModes: ["headless", "headful"],
  defaults: { browserMode: "headless", model: "javascript-model", maxResponseTurns: 24 },
};
export const pythonCapabilities: BackendCapabilities = {
  instanceId: "python-test-instance",
  backendId: "python", codeTool: "exec_py", browserModes: ["headful"],
  defaults: { browserMode: "headful", model: "python-model", maxResponseTurns: 18 },
};
export const javascriptBackendProps = { capabilities: javascriptCapabilities, expectedBackend: "javascript" as const };
export const pythonBackendProps = { capabilities: pythonCapabilities, expectedBackend: "python" as const };
