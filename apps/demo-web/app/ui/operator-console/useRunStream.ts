"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  runDetailSchema,
  runEventSchema,
  scenarioWorkspaceStateSchema,
  startRunResponseSchema,
  type BrowserMode,
  type ResponseTurnBudget,
  type RunDetail,
  type RunEvent,
  type ScenarioManifest,
  type ScenarioWorkspaceState,
} from "@cua-sample/replay-schema";

import {
  createManualLog,
  createManualTranscript,
  createRunnerIssue,
  createRunnerUnavailableIssue,
  defaultMaxResponseTurns,
  defaultRunModel,
  deriveRunFailureIssue,
  formatRunnerIssueMessage,
  mapManualLogToActivity,
  mapManualTranscriptToActivity,
  mapRunEventToActivity,
  parseRunnerIssue,
} from "./helpers";
import type { LogEntry, PendingAction, RunnerIssue, TranscriptEntry } from "./types";

const emptyScreenshots: NonNullable<RunDetail["browser"]>["screenshots"] = [];

class RunnerApiError extends Error {
  readonly issue: RunnerIssue;
  readonly status: number;

  constructor(issue: RunnerIssue, status: number) {
    super(issue.error);
    this.name = "RunnerApiError";
    this.issue = issue;
    this.status = status;
  }
}

type UseRunStreamOptions = {
  initialRunnerIssue: RunnerIssue | null;
  runnerBaseUrl: string;
  scenarios: ScenarioManifest[];
};

function createFallbackIssue(message: string, hint?: string) {
  return createRunnerIssue("runner_request_failed", message, hint);
}

function toRunnerIssue(
  error: unknown,
  fallbackMessage: string,
  fallbackHint?: string,
) {
  if (error instanceof RunnerApiError) {
    return error.issue;
  }

  if (error instanceof Error) {
    return createFallbackIssue(error.message, fallbackHint);
  }

  return createFallbackIssue(fallbackMessage, fallbackHint);
}

export function useRunStream({
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios,
}: UseRunStreamOptions) {
  const initialScenario = scenarios[0] ?? null;
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    initialScenario?.id ?? "",
  );
  const [browserMode, setBrowserMode] = useState<BrowserMode>("headless");
  const [verificationEnabled, setVerificationEnabled] = useState(false);
  const [maxResponseTurns, setMaxResponseTurns] =
    useState<ResponseTurnBudget>(defaultMaxResponseTurns);
  const [prompt, setPrompt] = useState(initialScenario?.defaultPrompt ?? "");
  const [streamLogs, setStreamLogs] = useState(true);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [workspaceState, setWorkspaceState] =
    useState<ScenarioWorkspaceState | null>(null);
  const [manualLogs, setManualLogs] = useState<LogEntry[]>([]);
  const [manualTranscript, setManualTranscript] = useState<TranscriptEntry[]>([]);
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<string | null>(null);
  const [followLatestScreenshot, setFollowLatestScreenshot] = useState(true);
  const [followActivityFeed, setFollowActivityFeed] = useState(true);
  const [actionIssue, setActionIssue] = useState<RunnerIssue | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const activityFeedRef = useRef<HTMLDivElement | null>(null);

  const selectedScenario =
    scenarios.find((scenario) => scenario.id === selectedScenarioId) ??
    initialScenario;
  const runnerOnline = !initialRunnerIssue && scenarios.length > 0;
  const selectedRun =
    activeRun && selectedScenario && activeRun.run.scenarioId === selectedScenario.id
      ? activeRun
      : null;
  const selectedBrowser = selectedRun?.browser ?? null;
  const screenshots = selectedBrowser?.screenshots ?? emptyScreenshots;
  const latestScreenshot = screenshots.at(-1) ?? null;
  const controlsLocked = selectedRun?.run.status === "running";
  const matchingWorkspaceState =
    workspaceState && workspaceState.scenarioId === selectedScenario?.id
      ? workspaceState
      : null;
  const runIssue = deriveRunFailureIssue(selectedRun);
  const currentIssue = runIssue ?? actionIssue ?? initialRunnerIssue;

  const activityItems = [
    ...runEvents.map((event) => mapRunEventToActivity(event, screenshots)),
    ...manualLogs.map(mapManualLogToActivity),
    ...manualTranscript.map(mapManualTranscriptToActivity),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const selectedScreenshot =
    screenshots.find((screenshot) => screenshot.id === selectedScreenshotId) ??
    latestScreenshot ??
    null;
  const selectedScreenshotIndex = selectedScreenshot
    ? screenshots.findIndex((screenshot) => screenshot.id === selectedScreenshot.id)
    : -1;
  const viewingLiveFrame =
    selectedScreenshotIndex >= 0 && selectedScreenshotIndex === screenshots.length - 1;
  const activityFeedLabel = streamLogs ? "live" : "paused";

  function appendManualLog(entry: LogEntry) {
    setManualLogs((current) => [...current.slice(-5), entry]);
  }

  function appendManualTranscript(entry: TranscriptEntry) {
    setManualTranscript((current) => [...current.slice(-3), entry]);
  }

  function closeEventStream() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  async function requestJson<T>(
    url: string,
    parser: { parse: (value: unknown) => T },
    init: RequestInit | undefined,
    fallbackIssue: RunnerIssue,
  ) {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new RunnerApiError(
        createRunnerUnavailableIssue(
          error instanceof Error ? error.message : undefined,
        ),
        0,
      );
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new RunnerApiError(
        parseRunnerIssue(payload) ?? fallbackIssue,
        response.status,
      );
    }

    return parser.parse(await response.json());
  }

  const fetchRunDetail = useCallback(
    async (runId: string) =>
      requestJson(
        `${runnerBaseUrl}/api/runs/${runId}`,
        runDetailSchema,
        undefined,
        createFallbackIssue(
          `Run detail request failed for ${runId}.`,
          "Refresh the page or start a new run.",
        ),
      ),
    [runnerBaseUrl],
  );

  const refreshRunDetail = useCallback(
    (runId: string) => {
      void fetchRunDetail(runId)
      .then((detail) => {
        setActiveRun(detail);
        setRunEvents(detail.events);
      })
      .catch(() => undefined);
    },
    [fetchRunDetail],
  );

  useEffect(() => {
    return () => {
      closeEventStream();
    };
  }, []);

  useEffect(() => {
    setSelectedScreenshotId(null);
    setFollowLatestScreenshot(true);
    setFollowActivityFeed(true);
  }, [selectedRun?.run.id]);

  useEffect(() => {
    if (screenshots.length === 0) {
      setSelectedScreenshotId(null);
      return;
    }

    const latestId = screenshots.at(-1)?.id ?? null;

    setSelectedScreenshotId((current) => {
      if (!current || followLatestScreenshot) {
        return latestId;
      }

      return screenshots.some((screenshot) => screenshot.id === current)
        ? current
        : latestId;
    });
  }, [followLatestScreenshot, latestScreenshot?.id, screenshots]);

  useEffect(() => {
    if (!followActivityFeed) {
      return;
    }

    const feed = activityFeedRef.current;

    if (!feed) {
      return;
    }

    if (typeof feed.scrollTo === "function") {
      feed.scrollTo({
        behavior: selectedRun?.run.status === "running" ? "smooth" : "auto",
        top: feed.scrollHeight,
      });
      return;
    }

    feed.scrollTop = feed.scrollHeight;
  }, [activityItems.length, followActivityFeed, selectedRun?.run.status]);

  useEffect(() => {
    if (!selectedRun || selectedRun.run.status !== "running" || !streamLogs) {
      closeEventStream();
      return;
    }

    const source = new EventSource(`${runnerBaseUrl}${selectedRun.eventStreamUrl}`);
    eventSourceRef.current = source;

    source.onmessage = (messageEvent) => {
      try {
        const event = runEventSchema.parse(JSON.parse(messageEvent.data));

        setRunEvents((current) =>
          current.some((existing) => existing.id === event.id)
            ? current
            : [...current, event],
        );

        if (
          event.type === "browser_session_started" ||
          event.type === "browser_navigated" ||
          event.type === "screenshot_captured"
        ) {
          refreshRunDetail(event.runId);
        }

        if (
          event.type === "run_completed" ||
          event.type === "run_failed" ||
          event.type === "run_cancelled"
        ) {
          void fetchRunDetail(event.runId)
            .then((detail) => {
              setActiveRun(detail);
              setRunEvents(detail.events);
            })
            .catch(() => undefined)
            .finally(() => {
              if (eventSourceRef.current === source) {
                source.close();
                eventSourceRef.current = null;
              }
            });
        }
      } catch {
        appendManualLog(
          createManualLog(
            "event.stream.parse_error",
            "Runner emitted an invalid SSE payload.",
            "error",
          ),
        );
      }
    };

    source.onerror = () => {
      if (eventSourceRef.current === source) {
        source.close();
        eventSourceRef.current = null;
      }
    };

    return () => {
      if (eventSourceRef.current === source) {
        source.close();
        eventSourceRef.current = null;
      }
    };
  }, [fetchRunDetail, refreshRunDetail, runnerBaseUrl, selectedRun, streamLogs]);

  const handleScenarioChange = (scenarioId: string) => {
    if (controlsLocked) {
      return;
    }

    const nextScenario =
      scenarios.find((scenario) => scenario.id === scenarioId) ?? null;

    setSelectedScenarioId(scenarioId);
    setManualLogs([]);
    setManualTranscript([]);
    setWorkspaceState(null);
    setActionIssue(null);

    if (!nextScenario) {
      return;
    }

    if (!selectedRun || selectedRun.run.status !== "running") {
      setActiveRun(null);
      setRunEvents([]);
    }

    setPrompt(nextScenario.defaultPrompt);
  };

  const handleOpenReplay = () => {
    if (!selectedRun) {
      appendManualLog(
        createManualLog(
          "replay.unavailable",
          "No run has been started for the selected scenario yet.",
          "warn",
        ),
      );
      return;
    }

    window.open(`${runnerBaseUrl}${selectedRun.replayUrl}`, "_blank");
  };

  const handleStartRun = async () => {
    if (!runnerOnline || !selectedScenario || prompt.trim().length === 0) {
      return;
    }

    setPendingAction("start");
    setManualLogs([]);
    setManualTranscript([]);
    setRunEvents([]);
    setActionIssue(null);
    closeEventStream();

    try {
      const started = await requestJson(
        `${runnerBaseUrl}/api/runs`,
        startRunResponseSchema,
        {
          body: JSON.stringify({
            browserMode,
            maxResponseTurns,
            model: defaultRunModel,
            prompt,
            scenarioId: selectedScenario.id,
            verificationEnabled,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
        createFallbackIssue(
          "Run start failed.",
          "Check the runner logs and confirm the scenario request is valid.",
        ),
      );
      const detail = await fetchRunDetail(started.runId);

      setActiveRun(detail);
      setRunEvents(detail.events);
      setWorkspaceState(null);
      appendManualTranscript(
        createManualTranscript(
          "control",
          "operator",
          `Run ${started.runId} started for ${selectedScenario.title}.`,
        ),
      );
    } catch (error) {
      const issue = toRunnerIssue(
        error,
        "Failed to start run.",
        "Check the runner and scenario configuration, then try again.",
      );

      setActionIssue(issue);
      appendManualLog(
        createManualLog("run.start_failed", formatRunnerIssueMessage(issue), "error"),
      );
      appendManualTranscript(
        createManualTranscript(
          "control",
          "runner",
          formatRunnerIssueMessage(issue),
        ),
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleStopRun = async () => {
    if (!selectedRun) {
      return;
    }

    setPendingAction("stop");

    try {
      const detail = await requestJson(
        `${runnerBaseUrl}/api/runs/${selectedRun.run.id}/stop`,
        runDetailSchema,
        {
          method: "POST",
        },
        createFallbackIssue(
          "Run stop failed.",
          "Refresh the run detail and try stopping the run again.",
        ),
      );

      setActiveRun(detail);
      setRunEvents(detail.events);
      setActionIssue(null);
      appendManualTranscript(
        createManualTranscript(
          "control",
          "operator",
          `Run ${detail.run.id} stopped by operator request.`,
        ),
      );
    } catch (error) {
      const issue = toRunnerIssue(
        error,
        "Failed to stop run.",
        "Refresh the run detail and try stopping the run again.",
      );

      setActionIssue(issue);
      appendManualLog(
        createManualLog("run.stop_failed", formatRunnerIssueMessage(issue), "error"),
      );
    } finally {
      closeEventStream();
      setPendingAction(null);
    }
  };

  const handleResetWorkspace = async () => {
    if (!runnerOnline || !selectedScenario) {
      return;
    }

    setPendingAction("reset");

    try {
      const state = await requestJson(
        `${runnerBaseUrl}/api/scenarios/${selectedScenario.id}/reset`,
        scenarioWorkspaceStateSchema,
        {
          method: "POST",
        },
        createFallbackIssue(
          "Workspace reset failed.",
          "Check the runner logs and try the reset again.",
        ),
      );

      setWorkspaceState(state);
      setActionIssue(null);
      appendManualLog(
        createManualLog(
          "scenario.workspace.reset",
          `Workspace reset at ${state.workspacePath}`,
          "ok",
        ),
      );
      appendManualTranscript(
        createManualTranscript(
          "control",
          "runner",
          `Scenario workspace reset to template baseline at ${state.workspacePath}.`,
        ),
      );

      if (state.cancelledRunId) {
        const cancelledDetail = await fetchRunDetail(state.cancelledRunId);
        setActiveRun(cancelledDetail);
        setRunEvents(cancelledDetail.events);
      } else if (!selectedRun || selectedRun.run.status !== "running") {
        setActiveRun(null);
        setRunEvents([]);
      }
    } catch (error) {
      const issue = toRunnerIssue(
        error,
        "Failed to reset workspace.",
        "Check the runner logs and try the reset again.",
      );

      setActionIssue(issue);
      appendManualLog(
        createManualLog(
          "scenario.reset_failed",
          formatRunnerIssueMessage(issue),
          "error",
        ),
      );
    } finally {
      closeEventStream();
      setPendingAction(null);
    }
  };

  const handleActivityFeedScroll = () => {
    const feed = activityFeedRef.current;

    if (!feed) {
      return;
    }

    const maxScrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight);

    if (maxScrollTop < 8) {
      setFollowActivityFeed(true);
      return;
    }

    const distanceFromBottom = maxScrollTop - feed.scrollTop;

    setFollowActivityFeed(distanceFromBottom < 40);
  };

  const handleJumpToLatestActivity = () => {
    const feed = activityFeedRef.current;

    if (!feed) {
      return;
    }

    setFollowActivityFeed(true);

    if (typeof feed.scrollTo === "function") {
      feed.scrollTo({ behavior: "smooth", top: feed.scrollHeight });
      return;
    }

    feed.scrollTop = feed.scrollHeight;
  };

  const handleSelectScreenshot = (screenshotId: string) => {
    const nextIndex = screenshots.findIndex(
      (screenshot) => screenshot.id === screenshotId,
    );

    if (nextIndex < 0) {
      return;
    }

    setSelectedScreenshotId(screenshotId);
    setFollowLatestScreenshot(nextIndex === screenshots.length - 1);
  };

  const handleJumpToLatestScreenshot = () => {
    if (!latestScreenshot) {
      return;
    }

    setSelectedScreenshotId(latestScreenshot.id);
    setFollowLatestScreenshot(true);
  };

  const handleScrubberChange = (value: string) => {
    const nextIndex = Number(value);
    const nextScreenshot = screenshots[nextIndex];

    if (!nextScreenshot) {
      return;
    }

    setSelectedScreenshotId(nextScreenshot.id);
    setFollowLatestScreenshot(nextIndex === screenshots.length - 1);
  };

  return {
    activityFeedLabel,
    activityFeedRef,
    activityItems,
    browserMode,
    controlsLocked,
    currentIssue,
    followActivityFeed,
    followLatestScreenshot,
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
    latestScreenshot,
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
  };
}
