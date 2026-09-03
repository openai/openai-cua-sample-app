"use client";

import type { RefObject } from "react";

import type { BrowserScreenshotArtifact } from "@cua-sample/replay-schema";

import { activityFamilyLabel } from "./helpers";
import type { ActivityItem } from "./types";

type ActivityFeedProps = {
  activityFeedLabel: string;
  activityFeedRef: RefObject<HTMLDivElement | null>;
  activityItems: ActivityItem[];
  followActivityFeed: boolean;
  onActivityFeedScroll: () => void;
  onJumpToLatestActivity: () => void;
  onSelectScreenshot: (screenshotId: string) => void;
  onStreamLogsChange: (value: boolean) => void;
  screenshots: BrowserScreenshotArtifact[];
  streamLogs: boolean;
};

export function ActivityFeed({
  activityFeedLabel,
  activityFeedRef,
  activityItems,
  followActivityFeed,
  onActivityFeedScroll,
  onJumpToLatestActivity,
  onSelectScreenshot,
  onStreamLogsChange,
  screenshots,
  streamLogs,
}: ActivityFeedProps) {
  return (
    <section className="railActivity">
      <div className="feedHeader">
        <div className="feedHeaderCopy">
          <h2>Agent activity</h2>
          <p>
            Watch tool calls, screenshots, and optional
            verification stream in real time.
          </p>
        </div>
        <div className="feedActions">
          {!followActivityFeed && activityItems.length > 0 ? (
            <button
              className="utilityButton"
              onClick={onJumpToLatestActivity}
              type="button"
            >
              Jump to live
            </button>
          ) : null}
          <label className="feedToggle">
            <input
              checked={streamLogs}
              onChange={(event) => onStreamLogsChange(event.target.checked)}
              type="checkbox"
            />
            Stream {activityFeedLabel}
          </label>
        </div>
      </div>

      <div
        className="activityFeed"
        onScroll={onActivityFeedScroll}
        ref={activityFeedRef}
      >
        {activityItems.length === 0 ? (
          <div className="activityEmpty">
            <h3>No activity yet</h3>
            <p>
              The live trace will appear here once the model starts calling
              tools, navigating, and finishing the scenario.
            </p>
          </div>
        ) : (
          activityItems.map((item) => {
            const expandable = Boolean(item.detail || item.code);
            const linkedFrameIndex = item.screenshotId
              ? screenshots.findIndex(
                  (screenshot) => screenshot.id === item.screenshotId,
                )
              : -1;
            const rowClassName = `activityRow family-${item.family} level-${item.level}`;
            const activitySummary = (
              <div className="activitySummary">
                <div className="activityBody">
                  <div className="activityMeta">
                    <span className={`activityFamily ${item.family}`}>
                      {activityFamilyLabel(item.family)}
                    </span>
                    <span className="activityHeadline">{item.headline}</span>
                    {linkedFrameIndex >= 0 ? (
                      <button
                        className="activityFrameButton"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const screenshot = screenshots[linkedFrameIndex];

                          if (!screenshot) {
                            return;
                          }

                          onSelectScreenshot(screenshot.id);
                        }}
                        type="button"
                      >
                        Frame {linkedFrameIndex + 1}
                      </button>
                    ) : null}
                    <time className="activityTime">{item.time}</time>
                  </div>
                  <p className="activityText">{item.summary}</p>
                </div>
              </div>
            );

            if (!expandable) {
              return (
                <div className={rowClassName} key={item.key}>
                  {activitySummary}
                </div>
              );
            }

            return (
              <details className={rowClassName} key={item.key}>
                <summary>{activitySummary}</summary>
                <div className="activityDetail">
                  {item.detail ? (
                    <pre className="activityPre">
                      <code>{item.detail}</code>
                    </pre>
                  ) : null}
                  {item.code ? (
                    <pre className="activityCode">
                      <code>{item.code}</code>
                    </pre>
                  ) : null}
                </div>
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}
