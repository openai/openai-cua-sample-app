import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDetail, ScenarioManifest } from "@cua-sample/replay-schema";

import HomePage from "./page";

const scenario: ScenarioManifest = {
  id: "paint-draw-poster", labId: "paint", category: "creativity", title: "Sketch Studio",
  description: "Draw and save", defaultPrompt: "Draw a poster", workspaceTemplatePath: "/tmp/paint",
  startTarget: { kind: "remote_url", url: "http://127.0.0.1:3103" }, supportsCodeEdits: false,
  tags: ["drawing"], verification: [{ id: "save", kind: "canvas_state", description: "Verify the save" }],
};
const active: RunDetail = {
  run: { id: "active-run", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headless",
    model: "test-model", prompt: "Draw a cat", status: "running", startedAt: "2026-09-03T00:00:00.000Z" },
  scenario, workspacePath: "/tmp/active-run", events: [],
  eventStreamUrl: "/api/runs/active-run/events", replayUrl: "/api/runs/active-run/replay",
};
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload }) as Response;

describe("console startup", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("hydrates the active run alongside the scenario registry", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => response(String(url).endsWith("/active") ? active : [scenario]));
    const view = await HomePage();
    expect(view.props).toMatchObject({ initialRun: active, scenarios: [scenario], initialRunnerIssue: null });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4001/api/runs/active", expect.objectContaining({ cache: "no-store" }));
  });

  it("allows idle startup only after the active-run endpoint confirms no run", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => response(String(url).endsWith("/active") ? null : [scenario]));
    expect((await HomePage()).props).toMatchObject({ initialRun: null, scenarios: [scenario], initialRunnerIssue: null });
  });

  it("blocks starting when active-run discovery fails instead of claiming the runner is idle", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).endsWith("/active")
      ? response({ code: "runner_unavailable", error: "Active run could not be loaded." }, 503)
      : response([scenario]));
    expect((await HomePage()).props).toMatchObject({ initialRun: null, scenarios: [],
      initialRunnerIssue: { code: "runner_unavailable", error: "Active run could not be loaded." } });
  });

  it("shows recovery guidance when active-run discovery stalls", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith("/active")
      ? new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))
      : Promise.resolve(response([scenario])));
    const loading = HomePage();
    await vi.advanceTimersByTimeAsync(5_000);
    const view = await loading;
    expect(view.props.scenarios).toEqual([]);
    expect(view.props.initialRunnerIssue?.error).toContain("timed out");
    expect(view.props.initialRunnerIssue?.hint).toContain("refresh the page");
  });
});
