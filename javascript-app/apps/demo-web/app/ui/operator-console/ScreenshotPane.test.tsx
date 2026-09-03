import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserScreenshotArtifact } from "@cua-sample/replay-schema";

import { ScreenshotPane } from "./ScreenshotPane";

const screenshots: BrowserScreenshotArtifact[] = [1, 2].map((index) => ({
  capturedAt: "2026-09-03T12:00:00.000Z",
  id: `frame-${index}`,
  label: `frame-${index}`,
  mimeType: "image/png",
  pageUrl: "http://127.0.0.1/lab",
  path: `/tmp/frame-${index}.png`,
  url: `/api/frames/${index}.png`,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ScreenshotPane", () => {
  it("reveals an offscreen thumbnail horizontally without scrolling ancestors", async () => {
    const callbacks = new Map<Element, () => void>();
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: () => void) {}
      observe(element: Element) { callbacks.set(element, this.callback); }
      disconnect() { callbacks.clear(); }
    });
    const user = userEvent.setup();
    const props = {
      emptyReviewMessage: "No frames yet",
      onJumpToLatestScreenshot: vi.fn(),
      onOpenReplay: vi.fn(),
      onScrubberChange: vi.fn(),
      onSelectScreenshot: vi.fn(),
      replayDisabled: false,
      runnerBaseUrl: "http://127.0.0.1:4001",
      screenshots,
      selectedBrowser: null,
      selectedRun: null,
      selectedScenarioTitle: "Launch Planner",
      selectedScreenshot: screenshots[1]!,
      selectedScreenshotIndex: 1,
      stageUrl: "http://127.0.0.1/lab",
      viewingLiveFrame: true,
    };
    const { container, rerender } = render(<ScreenshotPane {...props} />);
    await user.click(screen.getByRole("button", { name: "Show thumbnails" }));

    const filmstrip = container.querySelector<HTMLDivElement>(".filmstrip")!;
    const surface = container.querySelector<HTMLDivElement>(".browserSurface")!;
    let width = 200;
    Object.defineProperty(filmstrip, "clientWidth", { get: () => width });
    vi.spyOn(filmstrip, "getBoundingClientRect").mockReturnValue({ left: 100 } as DOMRect);
    for (const [index, left] of [100, 400].entries()) {
      vi.spyOn(screen.getByRole("button", { name: `View frame ${index + 1}` }), "getBoundingClientRect")
        .mockImplementation(() => ({ left: left - filmstrip.scrollLeft, width: 96 }) as DOMRect);
    }

    act(() => callbacks.get(filmstrip)!());
    expect(filmstrip.scrollLeft).toBe(196);
    expect(filmstrip.scrollTop).toBe(0);
    expect(surface.scrollTop).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);

    rerender(<ScreenshotPane {...props} selectedScreenshot={screenshots[0]!} selectedScreenshotIndex={0} />);
    expect(filmstrip.scrollLeft).toBe(0);

    width = 0;
    rerender(<ScreenshotPane {...props} />);
    expect(filmstrip.scrollLeft).toBe(0);
    width = 200;
    act(() => callbacks.get(filmstrip)!());
    expect(filmstrip.scrollLeft).toBe(196);
    expect(surface.scrollTop).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
  });
});
