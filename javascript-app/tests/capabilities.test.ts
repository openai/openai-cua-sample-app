import { expect, it, vi } from "vitest";
import { backendCapabilitiesSchema } from "@cua-sample/contracts";
import { createServer } from "../src/server.js";

it("publishes JavaScript capabilities and configured model", async () => {
  vi.stubEnv("CUA_DEFAULT_MODEL", "test-model");
  const server = createServer();
  try {
    const response = await server.inject({ method: "GET", url: "/api/capabilities" });
    expect(response.statusCode).toBe(200);
    expect(backendCapabilitiesSchema.parse(response.json())).toMatchObject({
      backendId: "javascript", codeTool: "exec_js", browserModes: ["headless", "headful"],
      defaults: { browserMode: "headless", model: "test-model", maxResponseTurns: 24 },
    });
  } finally { await server.close(); vi.unstubAllEnvs(); }
});

it("rejects stale-console mutations before validating or executing a run", async () => {
  const server = createServer();
  try {
    const response = await server.inject({ method: "POST", url: "/api/runs", headers: { "x-cua-backend": "python", origin: "http://127.0.0.1:3000" }, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("backend_mismatch");
    expect(response.headers["access-control-allow-headers"]).toContain("x-cua-backend");
    const active = await server.inject({ method: "GET", url: "/api/runs/active", headers: { "x-cua-backend": "javascript" } });
    expect(active.json()).toBeNull();
  } finally { await server.close(); }
});
