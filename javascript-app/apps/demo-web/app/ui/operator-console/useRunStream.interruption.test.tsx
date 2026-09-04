import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDetail, RunEvent } from "@cua-sample/replay-schema";

import { scenarioFixture as scenario } from "./test-fixtures";
import { useRunStream } from "./useRunStream";
import { OperatorConsole } from "./OperatorConsole";
import { runnerRequestTimeoutMs } from "./runner-request";

const baseUrl = "http://127.0.0.1:4041";
const makeDetail = (id = "demo-run"): RunDetail => ({
  run: { id, scenarioId: scenario.id, labId: scenario.labId, browserMode: "headful", model: "test-model", prompt: "Complete the demo task.", status: "running", startedAt: "2026-09-03T00:00:00.000Z" },
  scenario, workspacePath: `/tmp/${id}`, events: [],
  eventStreamUrl: `/api/runs/${id}/events`, replayUrl: `/api/runs/${id}/replay`,
});
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload }) as Response;
const startedResponse = (detail: RunDetail) => response({ detail, runId: detail.run.id, status: detail.run.status, eventStreamUrl: detail.eventStreamUrl, replayUrl: detail.replayUrl }, 202);
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor() { MockEventSource.instances.push(this); }
  emit(event: RunEvent) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
function mount(initialRun: RunDetail | null = null) {
  return renderHook(() => useRunStream({ initialRun, initialRunnerIssue: null, runnerBaseUrl: baseUrl, scenarios: [scenario] }));
}
function renderConsole() {
  return render(<OperatorConsole initialRunnerIssue={null} runnerBaseUrl={baseUrl} scenarios={[scenario]} />);
}

beforeEach(() => { vi.useFakeTimers(); MockEventSource.instances = []; vi.stubGlobal("EventSource", MockEventSource); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded console recovery", () => {
  it.each((["start", "stop", "reset"] as const).flatMap((action) =>
    (["headers", "body"] as const).map((stage) => ({ action, stage })),
  ))("bounds stalled $action $stage and releases pending controls", async ({ action, stage }) => {
    const detail = makeDetail();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.endsWith("/active") ? null : detail)));
    const hook = mount(action === "start" ? null : detail);
    let signal!: AbortSignal;
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      signal = init!.signal!;
      const pending = new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return stage === "headers" ? pending : Object.assign(response(null), { json: () => pending });
    });
    let pending!: Promise<void>;
    act(() => { pending = action === "start" ? hook.result.current.handleStartRun() : action === "stop" ? hook.result.current.handleStopRun() : hook.result.current.handleResetWorkspace(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(runnerRequestTimeoutMs); await pending; });
    expect(signal.aborted).toBe(true);
    expect(hook.result.current.pendingAction).toBeNull();
    if (action === "start") {
      expect(hook.result.current.startRecovery).toBe("empty");
      expect(hook.result.current.controlsLocked).toBe(false);
    } else expect(hook.result.current.currentIssue?.error).toContain("timed out");
  });

  it("adopts an accepted run after the Start response is lost without repeating POST", async () => {
    const recovered = makeDetail();
    recovered.run.prompt = "Resume this generic task.";
    recovered.run.maxResponseTurns = 7;
    recovered.run.verificationEnabled = true;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => { throw new Error("Connection interrupted"); } })
      .mockResolvedValueOnce(response(recovered)));
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([`${baseUrl}/api/runs`, `${baseUrl}/api/runs/active`]);
    expect(hook.result.current.selectedRun?.run.id).toBe(recovered.run.id);
    expect(hook.result.current.prompt).toBe(recovered.run.prompt);
    expect(hook.result.current.maxResponseTurns).toBe(7);
    expect(hook.result.current.verificationEnabled).toBe(true);
    expect(hook.result.current.startRecovery).toBeNull();
    expect(hook.result.current.pendingAction).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...recovered, run: { ...recovered.run, status: "cancelled" } }));
    await act(async () => { await hook.result.current.handleStopRun(); });
    expect(hook.result.current.selectedRun?.run.status).toBe("cancelled");
  });

  it("reconciles an accepted Start when its compatibility detail lookup fails", async () => {
    const detail = makeDetail();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ runId: detail.run.id, status: "running", eventStreamUrl: detail.eventStreamUrl, replayUrl: detail.replayUrl }, 202))
      .mockResolvedValueOnce(response({ code: "run_not_found", error: "Snapshot temporarily unavailable" }, 404))
      .mockResolvedValueOnce(response(detail)));
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    expect(hook.result.current.selectedRun?.run.id).toBe(detail.run.id);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      `${baseUrl}/api/runs`, `${baseUrl}/api/runs/${detail.run.id}`, `${baseUrl}/api/runs/active`,
    ]);
  });

  it("keeps an empty lookup unconfirmed and permits an explicit new run", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/active")) return response(null);
      if (++posts === 1) throw new Error("Start response lost");
      return startedResponse(makeDetail("new-run"));
    }));
    renderConsole();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Run" })); });
    expect(screen.getByRole("status").textContent).toContain("Previous start is unconfirmed. No active run was found.");
    expect((screen.getByRole("button", { name: "Start new run" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check again" })); });
    expect(posts).toBe(1);
    expect(screen.getByRole("status").textContent).toContain("unconfirmed");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start new run" })); });
    expect(posts).toBe(2);
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("allows Check again after lookup failure but blocks Start until a successful empty lookup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Runner unavailable")));
    renderConsole();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Run" })); });
    expect(screen.getByRole("status").textContent).toContain("could not be checked");
    expect((screen.getByRole("button", { name: "Start Run" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(response(null));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check again" })); });
    expect((screen.getByRole("button", { name: "Start new run" }) as HTMLButtonElement).disabled).toBe(false);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("bounds the reconciliation request too and leaves Check again available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Lost response"))
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })));
    const hook = mount();
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.handleStartRun(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(runnerRequestTimeoutMs); await pending; });
    expect(hook.result.current.pendingAction).toBeNull();
    expect(hook.result.current.startRecovery).toBe("unavailable");
    vi.mocked(fetch).mockResolvedValueOnce(response(null));
    await act(async () => { await hook.result.current.handleCheckStart(); });
    expect(hook.result.current.startRecovery).toBe("empty");
  });

  it("recovers terminal SSE after an older snapshot body stalls", async () => {
    const detail = makeDetail();
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...detail, run: { ...detail.run, status: "completed" } })));
    const hook = mount(detail);
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }) }) as Response);
    await act(async () => { MockEventSource.instances[0]!.onopen?.(); });
    await act(async () => {
      MockEventSource.instances[0]!.emit({ id: "terminal", runId: detail.run.id, sequence: 1, type: "run_completed", level: "ok", message: "Demo finished", createdAt: "2026-09-03T00:00:01.000Z" });
      await vi.advanceTimersByTimeAsync(runnerRequestTimeoutMs);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
    expect(hook.result.current.controlsLocked).toBe(false);
  });

  it("ignores an older snapshot after Stop races completion", async () => {
    const detail = makeDetail();
    let resolveSnapshot!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }))
      .mockResolvedValueOnce(response({ ...detail, run: { ...detail.run, status: "completed" } })));
    const hook = mount(detail);
    await act(async () => { MockEventSource.instances[0]!.onopen?.(); });
    await act(async () => { await hook.result.current.handleStopRun(); });
    await act(async () => { resolveSnapshot(response(detail)); });
    expect(hook.result.current.selectedRun?.run.status).toBe("completed");
    expect(hook.result.current.activityItems.some((item) => item.summary === `Run ${detail.run.id} is already completed.`)).toBe(true);
    expect(hook.result.current.activityItems.some((item) => item.summary.includes("stopped by operator"))).toBe(false);
  });

  it("aborts obsolete actions and ignores their late successful replies", async () => {
    let resolveOld!: (value: Response) => void;
    let oldSignal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce((_url, init) => {
      oldSignal = init!.signal!;
      return new Promise((resolve) => { resolveOld = resolve; });
    }).mockResolvedValueOnce(startedResponse(makeDetail("current-run"))));
    const hook = renderHook(({ url }) => useRunStream({ initialRunnerIssue: null, runnerBaseUrl: url, scenarios: [scenario] }), { initialProps: { url: baseUrl } });
    let oldStart!: Promise<void>;
    act(() => { oldStart = hook.result.current.handleStartRun(); });
    hook.rerender({ url: "http://127.0.0.1:5051" });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { await hook.result.current.handleStartRun(); });
    await act(async () => { resolveOld(startedResponse(makeDetail("obsolete-run"))); await oldStart; });
    expect(hook.result.current.selectedRun?.run.id).toBe("current-run");
    expect(hook.result.current.pendingAction).toBeNull();
  });

  it("aborts an in-flight snapshot and closes its stream on unmount", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signal = init!.signal!;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }));
    const hook = mount(makeDetail());
    await act(async () => { MockEventSource.instances[0]!.onopen?.(); });
    hook.unmount();
    expect(signal.aborted).toBe(true);
    expect(MockEventSource.instances[0]!.close).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
