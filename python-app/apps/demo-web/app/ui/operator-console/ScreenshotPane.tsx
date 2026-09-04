"use client";

import { useEffect, useRef, useState } from "react";

import type {
  BrowserScreenshotArtifact,
  BrowserState,
  RunDetail,
} from "@cua-sample/replay-schema";

import { formatClock, humanizeToken } from "./helpers";

type ScreenshotPaneProps = {
  emptyReviewMessage: string;
  onJumpToLatestScreenshot: () => void;
  onOpenReplay: () => void;
  onScrubberChange: (value: string) => void;
  onSelectScreenshot: (screenshotId: string) => void;
  replayDisabled: boolean;
  runnerBaseUrl: string;
  screenshots: BrowserScreenshotArtifact[];
  selectedBrowser: BrowserState | null;
  selectedRun: RunDetail | null;
  selectedScenarioTitle: string;
  selectedScreenshot: BrowserScreenshotArtifact | null;
  selectedScreenshotIndex: number;
  stageUrl: string;
  viewingLiveFrame: boolean;
};

export function ScreenshotPane({
  emptyReviewMessage,
  onJumpToLatestScreenshot,
  onOpenReplay,
  onScrubberChange,
  onSelectScreenshot,
  replayDisabled,
  runnerBaseUrl,
  screenshots,
  selectedBrowser,
  selectedRun,
  selectedScenarioTitle,
  selectedScreenshot,
  selectedScreenshotIndex,
  stageUrl,
  viewingLiveFrame,
}: ScreenshotPaneProps) {
  const [showThumbnails, setShowThumbnails] = useState(false);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const selectedThumbnailRef = useRef<HTMLButtonElement | null>(null);
  const screenshotCount = screenshots.length;

  useEffect(() => {
    const filmstrip = filmstripRef.current;
    const thumbnail = selectedThumbnailRef.current;
    if (!filmstrip || !thumbnail) return;

    const revealSelectedThumbnail = () => {
      if (filmstrip.clientWidth === 0) return;
      const stripBounds = filmstrip.getBoundingClientRect();
      const thumbnailBounds = thumbnail.getBoundingClientRect();
      const left = thumbnailBounds.left - stripBounds.left - filmstrip.clientLeft;
      const right = left + thumbnailBounds.width;
      // Only move the filmstrip: scrollIntoView can also scroll the console.
      if (left < 0) {
        filmstrip.scrollLeft += left;
      } else if (right > filmstrip.clientWidth) {
        filmstrip.scrollLeft += right - filmstrip.clientWidth;
      }
    };

    revealSelectedThumbnail();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealSelectedThumbnail);
    observer.observe(filmstrip);
    return () => observer.disconnect();
  }, [selectedScreenshot?.id, showThumbnails, screenshotCount]);
  const imageDimensions = selectedScreenshot?.imageWidth && selectedScreenshot.imageHeight
    ? { width: selectedScreenshot.imageWidth, height: selectedScreenshot.imageHeight }
    : !selectedScreenshot?.source || selectedScreenshot.source === "browser_preview" ? selectedBrowser?.viewport : undefined;
  const sourceLabel = selectedScreenshot?.source === "native_desktop" ? "Native desktop observation"
    : selectedScreenshot?.source === "code_tool" ? "Code tool image" : "Browser preview";

  return (
    <div className="browserSurface">
      <div className="stageChrome">
        <div className="stageUrl">{selectedScreenshot?.pageUrl ?? stageUrl}</div>
      </div>

      <div className="browserCanvas">
        <div className={`reviewSummary ${selectedScreenshot ? "" : "isEmpty"}`}>
          <div className="reviewCopy">
            <p className="reviewEyebrow">
              {selectedScreenshot
                ? selectedRun?.run.status === "running" && viewingLiveFrame
                  ? "Live frame"
                  : "Pinned frame"
                : selectedRun
                  ? "Awaiting frame"
                  : "Selected app"}
            </p>
            <h3>
              {selectedScreenshot
                ? selectedScreenshot.pageTitle?.trim() ||
                  humanizeToken(selectedScreenshot.label)
                : selectedScenarioTitle}
            </h3>
          </div>
          <div className="reviewMeta">
            {selectedScreenshot ? (
              <>
                <span className="readoutChip">{sourceLabel}</span>
                <span className="readoutChip">
                  Frame {selectedScreenshotIndex + 1} / {screenshotCount}
                </span>
                <span className="readoutChip">
                  {formatClock(selectedScreenshot.capturedAt)}
                </span>
                {imageDimensions ? (
                  <span className="readoutChip">
                    {imageDimensions.width} ×{" "}
                    {imageDimensions.height}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="readoutChip">No frames yet</span>
            )}
          </div>
        </div>

        <div className={`stageMedia ${selectedScreenshot ? "hasCapture" : ""}`}>
          {selectedScreenshot ? (
            // Replay frames come from the runner's artifact endpoint, so Next image optimization is not a fit here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`Captured frame ${selectedScreenshotIndex + 1} for ${selectedScenarioTitle}`}
              className="stageScreenshot"
              src={`${runnerBaseUrl}${selectedScreenshot.url}`}
            />
          ) : (
            <div className="stagePlaceholder">
              <h3>{selectedRun ? "Waiting for first frame" : "Ready to capture"}</h3>
              <p>{emptyReviewMessage}</p>
            </div>
          )}
        </div>

        <div className={`scrubberPanel ${screenshots.length === 0 ? "isEmpty" : ""}`}>
          <div className="scrubberRow">
            <div className="scrubberCopy">
              <h4>Review timeline</h4>
            </div>
            <div className="scrubberActions">
              <button
                aria-controls="frame-thumbnails"
                aria-expanded={showThumbnails}
                className="utilityButton"
                disabled={screenshotCount === 0}
                onClick={() => setShowThumbnails((shown) => !shown)}
                type="button"
              >
                {showThumbnails ? "Hide thumbnails" : "Show thumbnails"}
              </button>
              {!viewingLiveFrame && screenshots.length > 0 ? (
                <button
                  className="utilityButton"
                  onClick={onJumpToLatestScreenshot}
                  type="button"
                >
                  Jump to latest
                </button>
              ) : null}
              <button
                className="utilityButton"
                disabled={replayDisabled}
                onClick={onOpenReplay}
                type="button"
              >
                Replay JSON
              </button>
            </div>
          </div>

          <div className="scrubberRangeRow">
            <span className="scrubberCount">{screenshots.length > 0 ? 1 : 0}</span>
            <input
              aria-label="Captured frame scrubber"
              className="scrubberRange"
              disabled={screenshots.length <= 1}
              max={Math.max(0, screenshots.length - 1)}
              min={0}
              onChange={(event) => onScrubberChange(event.target.value)}
              step={1}
              type="range"
              value={
                screenshots.length > 0 ? Math.max(0, selectedScreenshotIndex) : 0
              }
            />
            <span className="scrubberCount">{screenshots.length}</span>
          </div>

          {showThumbnails && screenshots.length > 0 ? (
            <div className="filmstrip" id="frame-thumbnails" ref={filmstripRef}>
              {screenshots.map((screenshot, index) => (
                <button
                  aria-label={`View frame ${index + 1}`}
                  aria-pressed={screenshot.id === selectedScreenshot?.id}
                  className={`filmstripFrame ${
                    screenshot.id === selectedScreenshot?.id ? "isActive" : ""
                  }`}
                  key={screenshot.id}
                  onClick={() => onSelectScreenshot(screenshot.id)}
                  ref={screenshot.id === selectedScreenshot?.id ? selectedThumbnailRef : null}
                  type="button"
                >
                  {/* Filmstrip thumbnails also come from dynamic replay artifacts served by the runner. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`Frame ${index + 1}`}
                    className="filmstripThumb"
                    loading="lazy"
                    src={`${runnerBaseUrl}${screenshot.url}`}
                  />
                  <span className="filmstripMeta">
                    <span className="filmstripTitle">Frame {index + 1}</span>
                    <span className="filmstripTime">
                      {formatClock(screenshot.capturedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
