import { javascriptBackendProps } from "./fixtures";
import { scenarioFixture } from "./fixtures";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunDetail, RunEvent } from "@cua-sample/contracts";

import { useRunStream } from "../components/useRunStream";

const scenario = scenarioFixture;

const runDetail: RunDetail = {
  eventStreamUrl: "/api/runs/test-run/events",
  events: [],
  replayUrl: "/api/runs/test-run/replay",
  run: {
    browserMode: "headless",
    maxResponseTurns: 24,
    id: "test-run",
    labId: scenario.labId,
    model: "gpt-5.6-sol",
    prompt: scenario.defaultPrompt,
    scenarioId: scenario.id,
    startedAt: "2026-04-18T12:00:00.000Z",
    status: "running",
  },
  scenario,
  workspacePath: "/tmp/test-run/workspace",
};

class MockEventSource {
  static instances: MockEventSource[] = [];

  close() {}

  onerror: ((event: Event) => void) | null = null;

  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor() {
    MockEventSource.instances.push(this);
  }

  emit(event: RunEvent) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
}

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
  const stream = useRunStream({ ...javascriptBackendProps,
    initialRunnerIssue: null,
    runnerBaseUrl: "http://127.0.0.1:4001",
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
          detail: runDetail,
          eventStreamUrl: runDetail.eventStreamUrl,
          replayUrl: runDetail.replayUrl,
          runId: runDetail.run.id,
          status: "running",
        })),
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
