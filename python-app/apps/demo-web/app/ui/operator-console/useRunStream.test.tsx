import { scenarioFixture } from "./test-fixtures";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunDetail, RunEvent } from "@cua-sample/replay-schema";

import { useRunStream } from "./useRunStream";

const scenario = scenarioFixture;
const event: RunEvent = {
  id: "run-test:0", runId: "run-test", sequence: 0, type: "browser_session_started",
  level: "ok", message: "Browser started", createdAt: "2026-09-03T00:00:00.000Z",
};
const makeDetail = (): RunDetail => ({
  run: { id: "run-test", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headful", model: "test", prompt: "test", status: "running", startedAt: event.createdAt },
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

function mount() {
  return renderHook(() => useRunStream({ initialRunnerIssue: null, runnerBaseUrl: "http://127.0.0.1:4041", scenarios: [scenario] }));
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
        ? { runId: detail.run.id, status: "running", eventStreamUrl: detail.eventStreamUrl, replayUrl: detail.replayUrl }
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
    expect(fetch).toHaveBeenLastCalledWith("http://127.0.0.1:4041/api/runs/run-test/stop", expect.objectContaining({ method: "POST" }));
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

  it("ignores an old in-flight snapshot after the workspace resets", async () => {
    const hook = mount();
    await act(async () => { await hook.result.current.handleStartRun(); });
    let resolveSnapshot!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    await act(async () => { MockEventSource.instances[0]!.emit(event); });
    vi.mocked(fetch).mockResolvedValueOnce(response({ scenarioId: scenario.id, workspacePath: "/tmp/reset", resetAt: event.createdAt, cancelledRunId: detail.run.id }));
    detail.run.status = "cancelled";
    await act(async () => { await hook.result.current.handleResetWorkspace(); });
    await act(async () => { resolveSnapshot(response(makeDetail())); });
    expect(hook.result.current.selectedRun?.run.status).toBe("cancelled");
  });
});

const runDetail: RunDetail = {
  eventStreamUrl: "/api/runs/test-run/events",
  events: [],
  replayUrl: "/api/runs/test-run/replay",
  run: {
    browserMode: "headful",
    id: "test-run",
    labId: scenario.labId,
    model: "gpt-5.6",
    prompt: scenario.defaultPrompt,
    scenarioId: scenario.id,
    startedAt: "2026-04-18T12:00:00.000Z",
    status: "running",
  },
  scenario,
  workspacePath: "/tmp/test-run/workspace",
};

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  disconnected = false;

  observe = vi.fn();

  disconnect = vi.fn(() => {
    this.disconnected = true;
  });

  constructor(readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  static resize() {
    for (const observer of MockResizeObserver.instances) {
      if (!observer.disconnected) {
        observer.callback([], observer as unknown as ResizeObserver);
      }
    }
  }
}

function FeedHarness() {
  const stream = useRunStream({
    initialRunnerIssue: null,
    runnerBaseUrl: "http://127.0.0.1:4041",
    scenarios: [scenario],
  });

  return (
    <>
      <button onClick={() => void stream.handleStartRun()}>Start</button>
      <button onClick={stream.handleJumpToLatestActivity}>Jump to latest</button>
      <output aria-label="Following activity">{String(stream.followActivityFeed)}</output>
      <div
        aria-label="Activity"
        onScroll={stream.handleActivityFeedScroll}
        ref={stream.activityFeedRef}
        role="log"
      >
        {stream.activityItems.length} activity items
      </div>
    </>
  );
}

function setupFeed() {
  const result = render(<FeedHarness />);
  const feed = screen.getByRole("log");
  const layout = { height: 300, scrollHeight: 1_200, visible: true };
  let scrollTop = 0;
  const scrollWrites = vi.fn((top: number) => {
    scrollTop = Math.max(0, Math.min(top, layout.scrollHeight - layout.height));
  });

  Object.defineProperties(feed, {
    clientHeight: { get: () => (layout.visible ? layout.height : 0) },
    scrollHeight: { get: () => (layout.visible ? layout.scrollHeight : 0) },
    scrollTop: {
      get: () => (layout.visible ? scrollTop : 0),
      set: scrollWrites,
    },
    scrollTo: {
      value: vi.fn((options: ScrollToOptions) => {
        feed.scrollTop = options.top ?? feed.scrollTop;
      }),
    },
  });
  vi.spyOn(feed, "getClientRects").mockImplementation(
    () => ({ length: layout.visible ? 1 : 0 }) as DOMRectList,
  );

  return { ...result, feed, layout, scrollWrites };
}

async function startRun() {
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
}

function emitActivity(sequence: number) {
  act(() => {
    MockEventSource.instances.at(-1)!.emit({
      createdAt: `2026-04-18T12:00:0${sequence}.000Z`,
      id: `activity-${sequence}`,
      level: "pending",
      message: "Function tool call received from the model.",
      runId: runDetail.run.id,
      sequence,
      type: "function_call_requested",
    });
  });
}

describe("useRunStream activity scrolling", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    MockResizeObserver.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const response = (payload: unknown) => ({
      json: async () => payload,
      ok: true,
      status: 200,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          eventStreamUrl: runDetail.eventStreamUrl,
          replayUrl: runDetail.replayUrl,
          runId: runDetail.run.id,
          status: "running",
        }))
        .mockResolvedValueOnce(response(runDetail)),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("follows live events and catches up after a hidden panel is revealed", async () => {
    const { feed, layout, scrollWrites } = setupFeed();
    await startRun();

    layout.scrollHeight = 1_600;
    emitActivity(1);
    expect(feed.scrollTop).toBe(1_300);

    layout.visible = false;
    scrollWrites.mockClear();
    layout.scrollHeight = 2_000;
    emitActivity(2);
    fireEvent.scroll(feed);
    act(() => MockResizeObserver.resize());

    expect(scrollWrites).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Following activity").textContent).toBe("true");

    layout.visible = true;
    act(() => MockResizeObserver.resize());

    expect(feed.scrollTop).toBe(1_700);
    expect(screen.getByRole("log").textContent).toBe("3 activity items");
  });

  it("keeps the latest item visible when the panel height changes at a breakpoint", async () => {
    const { feed, layout } = setupFeed();
    await startRun();
    expect(feed.scrollTop).toBe(900);

    layout.height = 180;
    act(() => MockResizeObserver.resize());

    expect(feed.scrollTop).toBe(1_020);
    expect(screen.getByLabelText("Following activity").textContent).toBe("true");

    layout.height = 500;
    act(() => MockResizeObserver.resize());
    expect(feed.scrollTop).toBe(700);
  });

  it("preserves a manually reviewed position through hidden events, reveal, and resize", async () => {
    const { feed, layout, scrollWrites } = setupFeed();
    await startRun();
    feed.scrollTop = 120;
    fireEvent.scroll(feed);
    expect(screen.getByLabelText("Following activity").textContent).toBe("false");

    layout.visible = false;
    scrollWrites.mockClear();
    fireEvent.scroll(feed);
    layout.scrollHeight = 2_000;
    emitActivity(1);
    act(() => MockResizeObserver.resize());
    expect(screen.getByLabelText("Following activity").textContent).toBe("false");

    layout.visible = true;
    act(() => MockResizeObserver.resize());
    layout.height = 200;
    act(() => MockResizeObserver.resize());

    expect(scrollWrites).not.toHaveBeenCalled();
    expect(feed.scrollTop).toBe(120);
    expect(screen.getByLabelText("Following activity").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(feed.scrollTop).toBe(1_800);
    expect(screen.getByLabelText("Following activity").textContent).toBe("true");
    layout.scrollHeight = 2_500;
    emitActivity(2);
    expect(feed.scrollTop).toBe(2_300);
  });

  it("defers a hidden jump request until the feed has layout", async () => {
    const { feed, layout, scrollWrites } = setupFeed();
    await startRun();
    feed.scrollTop = 100;
    fireEvent.scroll(feed);
    layout.visible = false;
    scrollWrites.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));

    expect(scrollWrites).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Following activity").textContent).toBe("true");
    layout.visible = true;
    act(() => MockResizeObserver.resize());
    expect(feed.scrollTop).toBe(900);
  });

  it("disconnects the layout observer when the console unmounts", () => {
    const { feed, unmount } = setupFeed();
    const observer = MockResizeObserver.instances[0]!;
    expect(observer.observe).toHaveBeenCalledWith(feed);

    unmount();

    expect(observer.disconnect).toHaveBeenCalledOnce();
  });
});
