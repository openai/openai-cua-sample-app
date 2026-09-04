import { javascriptBackendProps } from "./fixtures";
import { scenarioFixture } from "./fixtures";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunDetail, RunEvent } from "@cua-sample/contracts";

import { useRunStream } from "../components/useRunStream";
import { runnerRequestTimeoutMs } from "../components/runner-request";

const scenario = scenarioFixture;
const event: RunEvent = {
  id: "run-test:0", runId: "run-test", sequence: 0, type: "browser_session_started",
  level: "ok", message: "Browser started", createdAt: "2026-09-03T00:00:00.000Z",
};
const makeDetail = (): RunDetail => ({
  run: { maxResponseTurns: 24, id: "run-test", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headless", model: "gpt-5.6-sol", prompt: "test", status: "running", startedAt: event.createdAt },
  scenario, workspacePath: "/tmp/run-test", eventStreamUrl: "/api/runs/run-test/events", replayUrl: "/api/runs/run-test/replay", events: [event],
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  close = vi.fn();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() { MockEventSource.instances.push(this); }
  emit(value: RunEvent) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

function response(payload: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => payload } as Response;
}

function mount(initialRun: RunDetail | null = null) {
  return renderHook(() => useRunStream({ ...javascriptBackendProps, initialRun, initialRunnerIssue: null, runnerBaseUrl: "http://127.0.0.1:4001", scenarios: [scenario] }));
}

describe("useRunStream recovery", () => {
  let detail: RunDetail;
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    detail = makeDetail();
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(
      url.endsWith("/api/runs")
        ? { detail: structuredClone(detail), runId: detail.run.id, status: "running", eventStreamUrl: detail.eventStreamUrl, replayUrl: detail.replayUrl }
        : structuredClone(detail),
    )));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("retains the accepted run and Stop when the next detail request fails", async () => {
    const hook = mount();
    vi.mocked(fetch).mockResolvedValueOnce(response({
      runId: detail.run.id, status: "running", eventStreamUrl: detail.eventStreamUrl,
      replayUrl: detail.replayUrl, detail: structuredClone(detail),
    }));
    await act(async () => { await hook.result.current.handleStartRun(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.selectedRun?.run.id).toBe("run-test");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Snapshot unavailable"));
    await act(async () => { MockEventSource.instances[0]!.onopen?.(); });
    expect(hook.result.current.selectedRun?.run.status).toBe("running");
    detail.run.status = "cancelled";
    await act(async () => { await hook.result.current.handleStopRun(); });
    expect(hook.result.current.selectedRun?.run.status).toBe("cancelled");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/api/runs"))).toHaveLength(1);
    expect(fetch).toHaveBeenLastCalledWith("http://127.0.0.1:4001/api/runs/run-test/stop", expect.objectContaining({ method: "POST" }));
  });

  it("keeps one connection when replayed browser events refresh the run", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    const source = MockEventSource.instances[0]!;
    for (let index = 0; index < 3; index += 1) {
      await act(async () => { source.emit(event); });
    }
    expect(MockEventSource.instances).toHaveLength(1);
    expect(source.close).not.toHaveBeenCalled();
    expect(hook.result.current.activityItems.filter((item) => item.key === "activity-run-test:0")).toHaveLength(1);
  });

  it("serializes overlapping snapshot requests and preserves events received while refreshing", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    const source = MockEventSource.instances[0]!;
    let resolveSnapshot!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    await act(async () => { source.emit(event); });
    const newerEvent = { ...event, id: "run-test:1", sequence: 1, type: "screenshot_captured" as const };
    await act(async () => { source.emit(newerEvent); });
    await act(async () => { source.emit(newerEvent); });
    expect(fetch).toHaveBeenCalledTimes(2);

    detail.run.status = "completed";
    await act(async () => { resolveSnapshot(response(makeDetail())); });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
    expect(hook.result.current.activityItems.filter((item) => item.key === "activity-run-test:1")).toHaveLength(1);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("locks scenario controls until a pending start request settles", async () => {
    const hook = mount();
    let resolveStart!: (value: Response) => void;
    let starting!: Promise<void>;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
    act(() => { starting = hook.result.current.handleStartRun(); });
    expect(hook.result.current.pendingAction).toBe("start");
    expect(hook.result.current.controlsLocked).toBe(true);
    act(() => { hook.result.current.handleScenarioChange("another-scenario"); });
    expect(hook.result.current.selectedScenarioId).toBe(scenario.id);
    await act(async () => {
      resolveStart(response({ code: "invalid_request", error: "Try again" }, 400));
      await starting;
    });
    expect(hook.result.current.pendingAction).toBeNull();
    expect(hook.result.current.controlsLocked).toBe(false);
  });

  it("leaves reconnection enabled and recovers completion through polling", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    const source = MockEventSource.instances[0]!;
    await act(async () => { source.onerror?.(); });
    expect(source.close).not.toHaveBeenCalled();
    expect(hook.result.current.activityFeedLabel).toBe("reconnecting");
    detail.run.status = "completed";
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
    expect(hook.result.current.controlsLocked).toBe(false);
    expect(source.close).toHaveBeenCalled();
  });

  it("retries a failed terminal snapshot without needing another SSE event", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network interrupted"));
    await act(async () => { MockEventSource.instances[0]!.emit({ ...event, id: "run-test:1", sequence: 1, type: "run_completed" }); });
    expect(hook.result.current.selectedRun?.run.status).toBe("running");
    detail.run.status = "completed";
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
  });

  it("updates run status while the activity feed is paused", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    act(() => { hook.result.current.setStreamLogs(false); });
    detail.run.status = "completed";
    detail.events.push({ ...event, id: "run-test:1", sequence: 1, type: "run_completed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
    expect(hook.result.current.activityFeedLabel).toBe("paused");
    expect(hook.result.current.activityItems.some((item) => item.key === "activity-run-test:1")).toBe(false);
    act(() => { hook.result.current.setStreamLogs(true); });
    expect(hook.result.current.activityItems.some((item) => item.key === "activity-run-test:1")).toBe(true);
  });

  it("keeps watching a run when a stop request fails", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    vi.mocked(fetch).mockResolvedValueOnce(response({ code: "stop_failed", error: "Try again" }, 500));
    await act(async () => { await hook.result.current.handleStopRun(); });
    expect(MockEventSource.instances[0]!.close).not.toHaveBeenCalled();
    expect(hook.result.current.selectedRun?.run.status).toBe("running");
  });

  it("keeps watching a run when a workspace reset fails", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    vi.mocked(fetch).mockResolvedValueOnce(response({ code: "reset_failed", error: "Try again" }, 500));
    await act(async () => { await hook.result.current.handleResetWorkspace(); });
    expect(MockEventSource.instances[0]!.close).not.toHaveBeenCalled();
    detail.run.status = "completed";
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
  });

  it("ignores an old in-flight snapshot after the workspace resets", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    let resolveSnapshot!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    await act(async () => { MockEventSource.instances[0]!.emit(event); });
    vi.mocked(fetch).mockResolvedValueOnce(response({ scenarioId: scenario.id, resetAt: event.createdAt, cancelledRunId: detail.run.id }));
    detail.run.status = "cancelled";
    await act(async () => { await hook.result.current.handleResetWorkspace(); });
    await act(async () => { resolveSnapshot(response(makeDetail())); });
    expect(hook.result.current.selectedRun?.run.status).toBe("cancelled");
  });

  it("recovers polling when a snapshot body stalls after the headers arrive", async () => {
    const hook = mount(structuredClone(detail));
    let signal!: AbortSignal;
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      signal = init!.signal!;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      } as Response;
    });
    await act(async () => { MockEventSource.instances[0]!.onopen?.(); });
    detail.run.status = "completed";
    await act(async () => { await vi.advanceTimersByTimeAsync(runnerRequestTimeoutMs); });
    expect(signal.aborted).toBe(true);
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
    expect(hook.result.current.controlsLocked).toBe(false);
  });

  it.each(["start", "stop", "reset"] as const)("unlocks a stalled %s request after its deadline", async (action) => {
    const hook = mount(action === "start" ? null : structuredClone(detail));
    let signal!: AbortSignal;
    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      signal = init!.signal!;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    let pending!: Promise<void>;
    act(() => {
      pending = action === "start" ? hook.result.current.handleStartRun()
        : action === "stop" ? hook.result.current.handleStopRun()
          : hook.result.current.handleResetWorkspace();
    });
    expect(hook.result.current.pendingAction).toBe(action);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(runnerRequestTimeoutMs);
      await pending;
    });
    expect(signal.aborted).toBe(true);
    expect(hook.result.current.pendingAction).toBeNull();
    if (action === "start") {
      expect(hook.result.current.selectedRun?.run.id).toBe(detail.run.id);
      expect(hook.result.current.startRecovery).toBeNull();
    } else {
      expect(hook.result.current.currentIssue?.error).toContain("timed out");
    }
  });
});
