"use client";

import { formatClock, formatRunnerIssueMessage, scenarioTargetDisplay } from "./helpers";
import { ActivityFeed } from "./ActivityFeed";
import { RunControls, RunActionButtons } from "./RunControls";
import { ConsoleTopbar, RunSummary } from "./RunSummary";
import { ScreenshotPane } from "./ScreenshotPane";
import type { OperatorConsoleProps } from "./types";
import { useRunStream } from "./useRunStream";

export function OperatorConsole({
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios,
}: OperatorConsoleProps) {
  const {
    activityFeedLabel,
    activityFeedRef,
    activityItems,
    browserMode,
    controlsLocked,
    currentIssue,
    followActivityFeed,
    handleActivityFeedScroll,
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
    setVerificationEnabled,
    streamLogs,
    verificationEnabled,
    viewingLiveFrame,
  } = useRunStream({
    initialRunnerIssue,
    runnerBaseUrl,
    scenarios,
  });

  const selectedScenarioTitle = selectedScenario?.title ?? "Selected app";
  const stageUrl =
    selectedBrowser?.currentUrl ??
    (selectedRun
      ? scenarioTargetDisplay(selectedScenario)
      : "Awaiting app launch");
  const startDisabled =
    !runnerOnline ||
    !selectedScenario ||
    pendingAction !== null ||
    controlsLocked ||
    prompt.trim().length === 0;
  const stopDisabled =
    !selectedRun ||
    selectedRun.run.status !== "running" ||
    pendingAction !== null;
  const resetDisabled =
    !runnerOnline || !selectedScenario || pendingAction === "start";
  const replayDisabled = !selectedRun;
  const issueMessage = currentIssue ? formatRunnerIssueMessage(currentIssue) : null;
  const stageHeadline = selectedRun
    ? selectedRun.run.status === "running"
      ? "Run active"
      : selectedRun.run.status === "completed"
        ? "Run completed"
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
      ? `Mutable workspace copied to ${matchingWorkspaceState.workspacePath} at ${formatClock(
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
  const emptyTimelineMessage = selectedRun
    ? selectedRun.run.status === "failed"
      ? issueMessage ?? "The run ended before any captures were saved."
      : "Captured frames will appear here as the run progresses."
    : currentIssue
      ? issueMessage ?? currentIssue.error
      : runnerOnline
        ? "Captured frames will appear here once the run starts."
        : issueMessage ?? "Runner is unavailable.";

  return (
    <main className="consoleShell">
      <section className="consoleFrame">
        <ConsoleTopbar
          runnerOnline={runnerOnline}
          topbarSubtitle={topbarSubtitle}
        />

        <section className="benchTop">
          <section className="controlColumn">
            <RunControls
              browserMode={browserMode}
              controlsLocked={controlsLocked}
              maxResponseTurns={maxResponseTurns}
              onBrowserModeChange={setBrowserMode}
              onMaxResponseTurnsChange={setMaxResponseTurns}
              onPromptChange={setPrompt}
              onResetWorkspace={handleResetWorkspace}
              onScenarioChange={handleScenarioChange}
              onStartRun={handleStartRun}
              onStopRun={handleStopRun}
              onVerificationEnabledChange={setVerificationEnabled}
              pendingAction={pendingAction}
              prompt={prompt}
              resetDisabled={resetDisabled}
              scenarios={scenarios}
              selectedScenarioId={selectedScenarioId}
              showActionButtons={false}
              startDisabled={startDisabled}
              stopDisabled={stopDisabled}
              verificationEnabled={verificationEnabled}
            />

            <ActivityFeed
              activityFeedLabel={activityFeedLabel}
              activityFeedRef={activityFeedRef}
              activityItems={activityItems}
              followActivityFeed={followActivityFeed}
              onActivityFeedScroll={handleActivityFeedScroll}
              onJumpToLatestActivity={handleJumpToLatestActivity}
              onSelectScreenshot={handleSelectScreenshot}
              onStreamLogsChange={setStreamLogs}
              screenshots={screenshots}
              streamLogs={streamLogs}
            />
          </section>

          <section className="stageColumn">
            <div className="stageControlBar">
              <RunSummary
                stageHeadline={stageHeadline}
                stageSupportCopy={stageSupportCopy}
              />
              <RunActionButtons
                onResetWorkspace={handleResetWorkspace}
                onStartRun={handleStartRun}
                onStopRun={handleStopRun}
                pendingAction={pendingAction}
                resetDisabled={resetDisabled}
                startDisabled={startDisabled}
                stopDisabled={stopDisabled}
              />
            </div>

            <ScreenshotPane
              emptyReviewMessage={emptyReviewMessage}
              emptyTimelineMessage={emptyTimelineMessage}
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
