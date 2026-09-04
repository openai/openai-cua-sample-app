"use client";

import { useState } from "react";

import { formatClock, formatRunnerIssueMessage } from "./helpers";
import { ActivityFeed } from "./ActivityFeed";
import { RunControls, RunActionButtons } from "./RunControls";
import { ConsoleTopbar, RunSummary } from "./RunSummary";
import { ScreenshotPane } from "./ScreenshotPane";
import type { OperatorConsoleProps } from "./types";
import { useRunStream } from "./useRunStream";

type WorkspacePanel = "controls" | "preview" | "activity";

export function OperatorConsole({
  capabilities,
  expectedBackend,
  initialRun = null,
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios,
}: OperatorConsoleProps) {
  const [activePanel, setActivePanel] = useState<WorkspacePanel>(initialRun ? "preview" : "controls");
  const {
    activityFeedLabel,
    activityFeedRef,
    activityItems,
    browserMode,
    controlsLocked,
    currentIssue,
    followActivityFeed,
    handleActivityFeedScroll,
    handleCheckStart,
    startRecovery,
    handleJumpToLatestActivity,
    handleJumpToLatestScreenshot,
    handleOpenReplay,
    handleResetWorkspace,
    handleScenarioChange,
    handleScrubberChange,
    handleSelectScreenshot,
    handleStartRun,
    handleStopRun,
    matchingWorkspaceState,
    maxResponseTurns,
    pendingAction,
    prompt,
    runnerOnline,
    screenshots,
    selectedBrowser,
    selectedRun,
    selectedScenario,
    selectedScreenshot,
    selectedScreenshotIndex,
    selectedScenarioId,
    setBrowserMode,
    setMaxResponseTurns,
    setPrompt,
    setStreamLogs,
    streamLogs,
    viewingLiveFrame,
  } = useRunStream({
    capabilities,
    expectedBackend,
    initialRun,
    initialRunnerIssue,
    runnerBaseUrl,
    scenarios,
  });

  const selectedScenarioTitle = selectedScenario?.title ?? "Selected app";
  const stageUrl =
    selectedBrowser?.currentUrl ??
    (selectedRun
      ? "Local lab"
      : "Awaiting app launch");
  const startDisabled =
    !runnerOnline ||
    !selectedScenario ||
    pendingAction !== null ||
    controlsLocked ||
    startRecovery === "unavailable" ||
    prompt.trim().length === 0;
  const stopDisabled =
    !runnerOnline ||
    !selectedRun ||
    selectedRun.run.status !== "running" ||
    pendingAction !== null;
  const resetDisabled =
    !runnerOnline || !selectedScenario || pendingAction !== null;
  const replayDisabled = !selectedRun;
  const issueMessage = currentIssue ? formatRunnerIssueMessage(currentIssue) : null;
  const stageHeadline = selectedRun
    ? selectedRun.run.status === "running"
      ? "Run active"
      : selectedRun.run.status === "completed"
        ? "Run finished"
        : selectedRun.run.status === "cancelled"
          ? "Run cancelled"
          : currentIssue?.title ?? "Run failed"
    : matchingWorkspaceState
      ? "Workspace reset"
      : currentIssue
        ? currentIssue.title
        : runnerOnline
          ? "Idle, ready"
          : "Runner offline";
  const stageSupportCopy = selectedRun
    ? selectedRun.run.status === "failed"
      ? issueMessage
      : null
    : matchingWorkspaceState
      ? `Scenario reset at ${formatClock(
          matchingWorkspaceState.resetAt,
        )}.`
      : currentIssue
        ? issueMessage
        : runnerOnline
        ? "Start a run to open the selected lab and stream activity into this console."
        : issueMessage;
  const topbarSubtitle = selectedRun
    ? `Reviewing ${selectedScenarioTitle}`
    : "Run, inspect, and review browser tasks.";
  const emptyReviewMessage = selectedRun
    ? selectedRun.run.status === "running"
      ? "The run is active. The first captured frame will appear here shortly."
      : selectedRun.run.status === "failed"
        ? issueMessage ?? "The run failed before a screenshot was captured."
        : "This run finished without a captured browser frame."
    : currentIssue
      ? issueMessage ?? currentIssue.error
      : runnerOnline
        ? "Start a run to begin reviewing captured frames."
        : issueMessage ?? "Runner is unavailable.";
  const startRunAndPreview = async () => {
    setActivePanel("preview");
    await handleStartRun();
  };

  return (
    <main className="consoleShell">
      <section className="consoleFrame">
        <ConsoleTopbar
          backendId={expectedBackend}
          runnerOnline={runnerOnline}
          topbarSubtitle={topbarSubtitle}
        />

        <div className="stageControlBar">
          <RunSummary
            stageHeadline={stageHeadline}
            stageSupportCopy={stageSupportCopy}
          />
          <RunActionButtons
            onResetWorkspace={handleResetWorkspace}
            onStartRun={startRunAndPreview}
            onStopRun={handleStopRun}
            pendingAction={pendingAction}
            resetDisabled={resetDisabled}
            startDisabled={startDisabled}
            startLabel={startRecovery === "empty" ? "Start new run" : "Start Run"}
            stopDisabled={stopDisabled}
          />
        </div>

        {startRecovery ? (
          <section aria-label="Start recovery" className="panel startRecoveryNotice" role="status">
            <p>
              {startRecovery === "checking"
                ? "Checking whether the previous run started…"
                : startRecovery === "empty"
                  ? "Previous start is unconfirmed. No active run was found. Check again, or start a new run."
                  : "Previous start is unconfirmed. The runner’s current state could not be checked."}
            </p>
            <button
              className="secondaryButton"
              disabled={pendingAction !== null}
              onClick={() => void handleCheckStart()}
              type="button"
            >
              {startRecovery === "checking" ? "Checking…" : "Check again"}
            </button>
          </section>
        ) : null}

        <nav aria-label="Workspace panels" className="workspacePanelNav">
          {(["controls", "preview", "activity"] as const).map((panel) => (
            <button
              aria-controls={`${panel}-pane`}
              aria-pressed={activePanel === panel}
              className="workspacePanelButton"
              key={panel}
              onClick={() => setActivePanel(panel)}
              type="button"
            >
              {panel === "controls"
                ? "Controls"
                : panel === "preview"
                  ? "Preview"
                  : "Activity"}
            </button>
          ))}
        </nav>

        <section className="benchTop" data-panel={activePanel}>
          <section className="controlColumn">
            <RunControls
              backendId={expectedBackend}
              browserModes={capabilities?.browserModes ?? []}
              browserMode={browserMode}
              controlsLocked={controlsLocked}
              maxResponseTurns={maxResponseTurns}
              onBrowserModeChange={setBrowserMode}
              onMaxResponseTurnsChange={setMaxResponseTurns}
              onPromptChange={setPrompt}
              onScenarioChange={handleScenarioChange}
              prompt={prompt}
              scenarios={scenarios}
              selectedScenarioId={selectedScenarioId}
            />

            <ActivityFeed
              activityFeedLabel={activityFeedLabel}
              activityFeedRef={activityFeedRef}
              activityItems={activityItems}
              followActivityFeed={followActivityFeed}
              onActivityFeedScroll={handleActivityFeedScroll}
              onJumpToLatestActivity={handleJumpToLatestActivity}
              onSelectScreenshot={(screenshotId) => {
                handleSelectScreenshot(screenshotId);
                setActivePanel("preview");
              }}
              onStreamLogsChange={setStreamLogs}
              screenshots={screenshots}
              streamLogs={streamLogs}
            />
          </section>

          <section
            aria-label="Screenshot preview"
            className="stageColumn"
            id="preview-pane"
          >
            <ScreenshotPane
              emptyReviewMessage={emptyReviewMessage}
              onJumpToLatestScreenshot={handleJumpToLatestScreenshot}
              onOpenReplay={handleOpenReplay}
              onScrubberChange={handleScrubberChange}
              onSelectScreenshot={handleSelectScreenshot}
              replayDisabled={replayDisabled}
              runnerBaseUrl={runnerBaseUrl}
              screenshots={screenshots}
              selectedBrowser={selectedBrowser}
              selectedRun={selectedRun}
              selectedScenarioTitle={selectedScenarioTitle}
              selectedScreenshot={selectedScreenshot}
              selectedScreenshotIndex={selectedScreenshotIndex}
              stageUrl={stageUrl}
              viewingLiveFrame={viewingLiveFrame}
            />
          </section>
        </section>
      </section>
    </main>
  );
}
