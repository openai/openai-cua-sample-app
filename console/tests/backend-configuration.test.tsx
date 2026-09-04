import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDetail, RunEvent } from "@cua-sample/contracts";

import { mapRunEventToActivity } from "../components/helpers";
import { OperatorConsole } from "../components/OperatorConsole";
import { useRunStream } from "../components/useRunStream";
import { javascriptBackendProps, pythonBackendProps, scenarioFixture as scenario } from "./fixtures";

const runnerBaseUrl = "http://127.0.0.1:4041";
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload }) as Response;
const detail: RunDetail = {
  run: { maxResponseTurns: 24, id: "python-run", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headful", model: "python-model", prompt: scenario.defaultPrompt, status: "running", startedAt: "2026-09-03T00:00:00.000Z" },
  scenario, workspacePath: "/tmp/python-run", events: [],
  eventStreamUrl: "/api/runs/python-run/events", replayUrl: "/api/runs/python-run/replay",
};
class MockEventSource {
  close = vi.fn();
  onmessage = null;
  onopen = null;
  onerror = null;
}

beforeEach(() => { vi.stubGlobal("EventSource", MockEventSource); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("launch-selected backend", () => {
  it("shows Python and derives its controls and start settings from capabilities", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ detail, runId: detail.run.id, status: "running", eventStreamUrl: detail.eventStreamUrl, replayUrl: detail.replayUrl }, 202));
    render(<OperatorConsole {...pythonBackendProps} initialRunnerIssue={null} runnerBaseUrl={runnerBaseUrl} scenarios={[scenario]} />);
    expect(screen.getByText("Python / PyAutoGUI")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /backend/i })).toBeNull();
    fireEvent.click(screen.getByText("Advanced settings"));
    expect(screen.queryByRole("button", { name: "Headless" })).toBeNull();
    expect(screen.getByText("Visible desktop")).toBeTruthy();
    expect((screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement).value).toBe("18");
    expect(screen.queryByRole("checkbox", { name: /verification/i })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Run" })); });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${runnerBaseUrl}/api/runs`);
    expect(init?.headers).toMatchObject({ "X-CUA-Backend": "python" });
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({ browserMode: "headful", model: "python-model", maxResponseTurns: 18 });
    expect(payload).not.toHaveProperty("verificationEnabled");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("blocks all actions when discovered capabilities do not match the launch backend", async () => {
    const hook = renderHook(() => useRunStream({ ...pythonBackendProps, expectedBackend: "javascript", initialRun: detail, initialRunnerIssue: null, runnerBaseUrl, scenarios: [scenario] }));
    expect(hook.result.current.runnerOnline).toBe(false);
    expect(hook.result.current.selectedRun).toBeNull();
    expect(hook.result.current.currentIssue?.code).toBe("backend_mismatch");
    await act(async () => {
      await hook.result.current.handleStartRun();
      await hook.result.current.handleStopRun();
      await hook.result.current.handleResetWorkspace();
      await hook.result.current.handleCheckStart();
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a replacement backend without reconciling or retrying Start", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ code: "backend_mismatch", error: "Expected python, but this runner is javascript." }, 409));
    const hook = renderHook(() => useRunStream({ ...pythonBackendProps, initialRunnerIssue: null, runnerBaseUrl, scenarios: [scenario] }));
    await act(async () => { await hook.result.current.handleStartRun(); });
    expect(hook.result.current.currentIssue?.code).toBe("backend_mismatch");
    expect(hook.result.current.runnerOnline).toBe(false);
    expect(hook.result.current.startRecovery).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await hook.result.current.handleResetWorkspace(); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["stop", "reset"] as const)("identifies the selected backend on %s and discards stale run state on mismatch", async (action) => {
    vi.mocked(fetch).mockResolvedValue(response({ code: "backend_mismatch", error: "The selected backend changed." }, 409));
    const hook = renderHook(() => useRunStream({ ...pythonBackendProps, initialRun: detail, initialRunnerIssue: null, runnerBaseUrl, scenarios: [scenario] }));
    await act(async () => { await (action === "stop" ? hook.result.current.handleStopRun() : hook.result.current.handleResetWorkspace()); });
    expect(vi.mocked(fetch).mock.calls[0]![1]?.headers).toMatchObject({ "X-CUA-Backend": "python" });
    expect(hook.result.current.selectedRun).toBeNull();
    expect(hook.result.current.currentIssue?.code).toBe("backend_mismatch");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves definitive desktop cleanup guidance without checking or retrying Start", async () => {
    const error = "Desktop input cleanup failed. New runs are blocked.";
    const hint = "Release held keys and mouse buttons, then restart the runner.";
    vi.mocked(fetch).mockResolvedValue(response({ code: "desktop_cleanup_failed", error, hint }, 503));
    render(<OperatorConsole {...pythonBackendProps} initialRunnerIssue={null} runnerBaseUrl={runnerBaseUrl} scenarios={[scenario]} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Run" })); });
    expect(screen.getAllByText(`${error} ${hint}`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("labels both code tools and preserves the returned source code", () => {
    for (const [tool, code, headline] of [["exec_js", "console.log('hello')", "Run browser script"], ["exec_py", "log('hello')", "Run Python code"]]) {
      const event: RunEvent = { id: "tool-event", runId: "run", sequence: 1, type: "function_call_requested", level: "pending", message: "Function tool call received from the model.", detail: `${tool} ${JSON.stringify({ code })}`, createdAt: "2026-09-03T00:00:00.000Z" };
      const activity = mapRunEventToActivity(event, []);
      expect(activity.code).toBe(code);
      expect(activity.headline).toBe(headline);
    }
  });

  it("shows the JavaScript subheader when JavaScript is selected", () => {
    render(<OperatorConsole {...javascriptBackendProps} initialRunnerIssue={null} runnerBaseUrl="http://127.0.0.1:4001" scenarios={[scenario]} />);
    expect(screen.getByText("JavaScript / Playwright")).toBeTruthy();
    expect(screen.queryByText("Python / PyAutoGUI")).toBeNull();
  });
});
