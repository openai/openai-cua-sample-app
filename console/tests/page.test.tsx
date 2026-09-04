import { javascriptCapabilities, pythonCapabilities, scenarioFixture } from "./fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDetail } from "@cua-sample/contracts";

import HomePage from "../app/page";

const scenario = scenarioFixture;
const active: RunDetail = {
  run: { id: "active-run", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headless",
    maxResponseTurns: 24,
    model: "test-model", prompt: "Complete the alternate task.", status: "running", startedAt: "2026-09-03T00:00:00.000Z" },
  scenario, workspacePath: "/tmp/active-run", events: [],
  eventStreamUrl: "/api/runs/active-run/events", replayUrl: "/api/runs/active-run/replay",
};
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload }) as Response;

describe("console startup", () => {
  beforeEach(() => { vi.stubEnv("CUA_BACKEND", "javascript"); vi.stubEnv("RUNNER_BASE_URL", "http://127.0.0.1:4001"); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it("loads Python capabilities from its configured backend without a selector", async () => {
    vi.stubEnv("CUA_BACKEND", "python");
    vi.stubEnv("RUNNER_BASE_URL", "http://127.0.0.1:4041");
    vi.mocked(fetch).mockImplementation(async (url) => response(String(url).endsWith("/capabilities") ? pythonCapabilities : String(url).endsWith("/active") ? null : [scenario]));
    expect((await HomePage()).props).toMatchObject({ expectedBackend: "python", capabilities: pythonCapabilities, runnerBaseUrl: "http://127.0.0.1:4041", initialRunnerIssue: null });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4041/api/scenarios", expect.objectContaining({ headers: { "X-CUA-Backend": "python" } }));
  });

  it("rejects a backend mismatch before hydrating any run state", async () => {
    vi.mocked(fetch).mockResolvedValue(response(pythonCapabilities));
    const view = await HomePage();
    expect(view.props).toMatchObject({ expectedBackend: "javascript", initialRun: null, scenarios: [], initialRunnerIssue: { code: "backend_mismatch" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps actions unavailable when capabilities cannot be discovered", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Connection refused"));
    const view = await HomePage();
    expect(view.props).toMatchObject({ capabilities: null, initialRun: null, scenarios: [], initialRunnerIssue: { code: "runner_unavailable" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports invalid backend launch configuration", async () => {
    vi.stubEnv("CUA_BACKEND", "unknown");
    expect((await HomePage()).props.initialRunnerIssue).toMatchObject({ code: "invalid_configuration" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hydrates the active run alongside the scenario registry", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => response(String(url).endsWith("/capabilities") ? javascriptCapabilities : String(url).endsWith("/active") ? active : [scenario]));
    const view = await HomePage();
    expect(view.props).toMatchObject({ initialRun: active, scenarios: [scenario], initialRunnerIssue: null });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4001/api/runs/active", expect.objectContaining({ cache: "no-store" }));
  });

  it("allows idle startup only after the active-run endpoint confirms no run", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => response(String(url).endsWith("/capabilities") ? javascriptCapabilities : String(url).endsWith("/active") ? null : [scenario]));
    expect((await HomePage()).props).toMatchObject({ initialRun: null, scenarios: [scenario], initialRunnerIssue: null });
  });

  it("blocks starting when active-run discovery fails instead of claiming the runner is idle", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).endsWith("/active")
      ? response({ code: "runner_unavailable", error: "Active run could not be loaded." }, 503)
      : response(String(url).endsWith("/capabilities") ? javascriptCapabilities : [scenario]));
    expect((await HomePage()).props).toMatchObject({ initialRun: null, scenarios: [],
      initialRunnerIssue: { code: "runner_unavailable", error: "Active run could not be loaded." } });
  });

  it("shows recovery guidance when active-run discovery stalls", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith("/active")
      ? new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))
      : Promise.resolve(response(String(url).endsWith("/capabilities") ? javascriptCapabilities : [scenario])));
    const loading = HomePage();
    await vi.advanceTimersByTimeAsync(5_000);
    const view = await loading;
    expect(view.props.scenarios).toEqual([]);
    expect(view.props.initialRunnerIssue?.error).toContain("timed out");
    expect(view.props.initialRunnerIssue?.hint).toContain("refresh the page");
  });
});
