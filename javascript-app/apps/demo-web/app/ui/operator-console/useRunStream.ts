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
  configuredRunModel,
  deriveRunFailureIssue,
  formatRunnerIssueMessage,
  mapManualLogToActivity,
  mapManualTranscriptToActivity,
  mapRunEventToActivity,
  parseRunnerIssue,
} from "./helpers";
import type { LogEntry, PendingAction, RunnerIssue, TranscriptEntry } from "./types";
import { requestRunnerJson } from "./runner-request";

const emptyScreenshots: NonNullable<RunDetail["browser"]>["screenshots"] = [];
const runRefreshIntervalMs = 2_000;

function mergeRunEvents(current: RunEvent[], incoming: RunEvent[]) {
  const events = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    events.set(event.id, event);
  }
  return [...events.values()].sort((left, right) => left.sequence - right.sequence);
}

function hasActivityFeedLayout(feed: HTMLDivElement) {
  return feed.clientHeight > 0 && feed.getClientRects().length > 0;
}

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
  initialRun?: RunDetail | null;
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

async function requestJson<T>(
  url: string,
  parser: { parse: (value: unknown) => T },
  init: RequestInit | undefined,
  fallbackIssue: RunnerIssue,
) {
  let response: Response;
  let payload: unknown;

  try {
    ({ response, payload } = await requestRunnerJson(url, init));
  } catch (error) {
    throw new RunnerApiError(
      createRunnerUnavailableIssue(
        error instanceof Error ? error.message : undefined,
      ),
      0,
    );
  }

  if (!response.ok) {
    throw new RunnerApiError(
      parseRunnerIssue(payload) ?? fallbackIssue,
      response.status,
    );
  }

  return parser.parse(payload);
}

type ActionRequest = { controller: AbortController; generation: number };

type StartRecovery = "checking" | "empty" | "unavailable" | null;

export function useRunStream({
  initialRun = null,
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios,
}: UseRunStreamOptions) {
  const initialScenario = scenarios.find((scenario) => scenario.id === initialRun?.run.scenarioId) ?? scenarios[0] ?? null;
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    initialScenario?.id ?? "",
  );
  const [browserMode, setBrowserMode] = useState<BrowserMode>(initialRun?.run.browserMode ?? "headless");
  const [verificationEnabled, setVerificationEnabled] = useState(initialRun?.run.verificationEnabled ?? false);
  const [maxResponseTurns, setMaxResponseTurns] =
    useState<ResponseTurnBudget>(initialRun?.run.maxResponseTurns ?? defaultMaxResponseTurns);
  const [prompt, setPrompt] = useState(initialRun?.run.prompt ?? initialScenario?.defaultPrompt ?? "");
  const [streamLogs, setStreamLogs] = useState(true);
  const [streamState, setStreamState] = useState("live");
  const [activeRun, setActiveRun] = useState<RunDetail | null>(initialRun);
  const [runEvents, setRunEvents] = useState<RunEvent[]>(initialRun?.events ?? []);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [workspaceState, setWorkspaceState] =
    useState<ScenarioWorkspaceState | null>(null);
  const [manualLogs, setManualLogs] = useState<LogEntry[]>([]);
  const [manualTranscript, setManualTranscript] = useState<TranscriptEntry[]>([]);
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<string | null>(null);
  const [followLatestScreenshot, setFollowLatestScreenshot] = useState(true);
  const [followActivityFeed, setFollowActivityFeed] = useState(true);
  const [actionIssue, setActionIssue] = useState<RunnerIssue | null>(null);
  const [startRecovery, setStartRecovery] = useState<StartRecovery>(null);

  const actionGenerationRef = useRef(0);
  const actionRequestRef = useRef<ActionRequest | null>(null);
  const viewGenerationRef = useRef(0);

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
  const controlsLocked = selectedRun?.run.status === "running" || pendingAction !== null;
  const selectedRunId = selectedRun?.run.id;
  const selectedRunStatus = selectedRun?.run.status;
  const selectedEventStreamUrl = selectedRun?.eventStreamUrl;
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
  const activityFeedLabel = streamLogs ? streamState : "paused";

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

  const fetchRunDetail = useCallback(
    async (runId: string, signal: AbortSignal) =>
      requestJson(
        `${runnerBaseUrl}/api/runs/${runId}`,
        runDetailSchema,
        { signal },
        createFallbackIssue(
          `Run detail request failed for ${runId}.`,
          "Refresh the page or start a new run.",
        ),
      ),
    [runnerBaseUrl],
  );

  useEffect(() => {
    setPendingAction(null);
    return () => {
      actionGenerationRef.current += 1;
      actionRequestRef.current?.controller.abort();
      actionRequestRef.current = null;
      closeEventStream();
    };
  }, [runnerBaseUrl]);

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

    if (!feed || !hasActivityFeedLayout(feed)) {
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
    const feed = activityFeedRef.current;

    if (!feed || typeof ResizeObserver === "undefined") {
      return;
    }

    // Hidden responsive panels have no scroll geometry. Resume following when
    // the feed is revealed or its available height changes at a breakpoint.
    const observer = new ResizeObserver(() => {
      if (followActivityFeed && hasActivityFeedLayout(feed)) {
        feed.scrollTop = feed.scrollHeight;
      }
    });

    observer.observe(feed);

    return () => observer.disconnect();
  }, [followActivityFeed]);

  useEffect(() => {
    if (streamLogs && selectedRun && selectedRun.run.status !== "running") {
      setRunEvents((current) => mergeRunEvents(current, selectedRun.events));
    }
  }, [selectedRun, streamLogs]);

  useEffect(() => {
    if (!selectedRunId || selectedRunStatus !== "running" || !selectedEventStreamUrl) {
      closeEventStream();
      setStreamState("live");
      return;
    }

    let disposed = false;
    const controller = new AbortController();
    let refreshing = false;
    let refreshAgain = false;

    // Serialize snapshots so a slower, older response cannot undo newer state.
    // Polling also recovers terminal state when SSE or the final detail fetch fails.
    const refreshDetail = () => {
      if (disposed) return;
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      const generation = viewGenerationRef.current;
      void fetchRunDetail(selectedRunId, controller.signal)
        .then((detail) => {
          if (disposed || generation !== viewGenerationRef.current) return;
          setActiveRun((current) =>
            current?.run.id === selectedRunId && current.run.status === "running"
              ? detail
              : current,
          );
          if (streamLogs) {
            setRunEvents((current) => mergeRunEvents(current, detail.events));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
          if (refreshAgain && !disposed) {
            refreshAgain = false;
            refreshDetail();
          }
        });
    };
    const refreshTimer = window.setInterval(refreshDetail, runRefreshIntervalMs);
    const source = streamLogs
      ? new EventSource(`${runnerBaseUrl}${selectedEventStreamUrl}`)
      : null;
    eventSourceRef.current = source;

    if (source) {
      setStreamState("connecting");
      source.onopen = () => {
        if (disposed) return;
        setStreamState("live");
        refreshDetail();
      };
      source.onmessage = (messageEvent) => {
        if (disposed) return;
        try {
          const event = runEventSchema.parse(JSON.parse(messageEvent.data));
          if (event.runId !== selectedRunId) return;
          setRunEvents((current) => mergeRunEvents(current, [event]));

          if (
            event.type === "browser_session_started" ||
            event.type === "browser_navigated" ||
            event.type === "screenshot_captured" ||
            event.type === "run_completed" ||
            event.type === "run_failed" ||
            event.type === "run_cancelled"
          ) {
            refreshDetail();
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
        if (disposed) return;
        setStreamState("reconnecting");
        // Keep EventSource open so its built-in retry can reconnect.
        refreshDetail();
      };
    }

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(refreshTimer);
      source?.close();
      if (eventSourceRef.current === source) eventSourceRef.current = null;
    };
  }, [fetchRunDetail, runnerBaseUrl, selectedEventStreamUrl, selectedRunId, selectedRunStatus, streamLogs]);

  const handleScenarioChange = (scenarioId: string) => {
    if (controlsLocked || actionRequestRef.current) {
      return;
    }

    viewGenerationRef.current += 1;
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

  function beginAction(action: Exclude<PendingAction, null>) {
    if (actionRequestRef.current) return null;
    const request = {
      controller: new AbortController(),
      generation: ++actionGenerationRef.current,
    };
    actionRequestRef.current = request;
    setPendingAction(action);
    return request;
  }

  function isCurrentAction(request: ActionRequest) {
    return actionRequestRef.current === request &&
      request.generation === actionGenerationRef.current &&
      !request.controller.signal.aborted;
  }

  function finishAction(request: ActionRequest) {
    if (!isCurrentAction(request)) return;
    actionRequestRef.current = null;
    setPendingAction(null);
  }

  function adoptRun(detail: RunDetail) {
    viewGenerationRef.current += 1;
    setActiveRun(detail);
    setRunEvents(detail.events);
    setSelectedScenarioId(detail.run.scenarioId);
    setBrowserMode(detail.run.browserMode);
    setVerificationEnabled(detail.run.verificationEnabled ?? false);
    setMaxResponseTurns(detail.run.maxResponseTurns ?? defaultMaxResponseTurns);
    setPrompt(detail.run.prompt);
    setWorkspaceState(null);
    setStartRecovery(null);
    setActionIssue(null);
  }

  async function reconcileStart(request: ActionRequest) {
    setStartRecovery("checking");
    setPendingAction("check");
    try {
      const detail = await requestJson(
        `${runnerBaseUrl}/api/runs/active`,
        runDetailSchema.nullable(),
        { signal: request.controller.signal },
        createFallbackIssue("The runner's current state could not be checked."),
      );
      if (!isCurrentAction(request)) return;
      if (detail) {
        adoptRun(detail);
        appendManualTranscript(createManualTranscript(
          "control", "runner", `Recovered run ${detail.run.id}.`,
        ));
      } else {
        // An empty active lookup cannot tell whether the previous run finished
        // or whether its start request has not reached admission yet.
        setStartRecovery("empty");
      }
    } catch (error) {
      if (!isCurrentAction(request)) return;
      setStartRecovery("unavailable");
      appendManualLog(createManualLog(
        "run.recovery_unavailable",
        formatRunnerIssueMessage(toRunnerIssue(error, "The runner's current state could not be checked.")),
        "warn",
      ));
    }
  }

  const handleCheckStart = async () => {
    const request = beginAction("check");
    if (!request) return;
    try {
      await reconcileStart(request);
    } finally {
      finishAction(request);
    }
  };

  const handleStartRun = async () => {
    if (!runnerOnline || !selectedScenario || controlsLocked ||
      startRecovery === "unavailable" || prompt.trim().length === 0) {
      return;
    }

    const request = beginAction("start");
    if (!request) return;
    setStartRecovery(null);
    setManualLogs([]);
    setManualTranscript([]);
    setRunEvents([]);
    setActionIssue(null);
    closeEventStream();
    let startAccepted = false;

    try {
      const started = await requestJson(
        `${runnerBaseUrl}/api/runs`,
        startRunResponseSchema,
        {
          body: JSON.stringify({
            browserMode,
            maxResponseTurns,
            ...(configuredRunModel ? { model: configuredRunModel } : {}),
            prompt,
            scenarioId: selectedScenario.id,
            verificationEnabled,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: request.controller.signal,
        },
        createFallbackIssue(
          "Run start failed.",
          "Check the runner logs and confirm the scenario request is valid.",
        ),
      );
      startAccepted = true;
      const detail = started.detail ?? await fetchRunDetail(started.runId, request.controller.signal);
      if (!isCurrentAction(request)) return;
      adoptRun(detail);
      appendManualTranscript(
        createManualTranscript(
          "control",
          "operator",
          `Run ${started.runId} started for ${selectedScenario.title}.`,
        ),
      );
    } catch (error) {
      if (!isCurrentAction(request)) return;
      const ambiguous = startAccepted || !(error instanceof RunnerApiError) ||
        error.status === 0 || error.status === 408 || error.status === 409 || error.status >= 500;
      if (ambiguous) {
        await reconcileStart(request);
        return;
      }
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
      finishAction(request);
    }
  };

  const handleStopRun = async () => {
    if (!selectedRun) {
      return;
    }

    const request = beginAction("stop");
    if (!request) return;

    try {
      const detail = await requestJson(
        `${runnerBaseUrl}/api/runs/${selectedRun.run.id}/stop`,
        runDetailSchema,
        {
          method: "POST",
          signal: request.controller.signal,
        },
        createFallbackIssue(
          "Run stop failed.",
          "Refresh the run detail and try stopping the run again.",
        ),
      );

      if (!isCurrentAction(request)) return;
      viewGenerationRef.current += 1;
      setActiveRun(detail);
      setRunEvents(detail.events);
      setActionIssue(null);
      appendManualTranscript(
        createManualTranscript(
          "control",
          "operator",
          detail.run.status === "cancelled"
            ? `Run ${detail.run.id} stopped by operator request.`
            : `Run ${detail.run.id} is already ${detail.run.status}.`,
        ),
      );
    } catch (error) {
      if (!isCurrentAction(request)) return;
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
      finishAction(request);
    }
  };

  const handleResetWorkspace = async () => {
    if (!runnerOnline || !selectedScenario) {
      return;
    }

    const request = beginAction("reset");
    if (!request) return;

    try {
      const state = await requestJson(
        `${runnerBaseUrl}/api/scenarios/${selectedScenario.id}/reset`,
        scenarioWorkspaceStateSchema,
        {
          method: "POST",
          signal: request.controller.signal,
        },
        createFallbackIssue(
          "Workspace reset failed.",
          "Check the runner logs and try the reset again.",
        ),
      );

      if (!isCurrentAction(request)) return;
      viewGenerationRef.current += 1;
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
        const cancelledDetail = await fetchRunDetail(state.cancelledRunId, request.controller.signal);
        if (!isCurrentAction(request)) return;
        viewGenerationRef.current += 1;
        setActiveRun(cancelledDetail);
        setRunEvents(cancelledDetail.events);
      } else if (!selectedRun || selectedRun.run.status !== "running") {
        setActiveRun(null);
        setRunEvents([]);
      }
    } catch (error) {
      if (!isCurrentAction(request)) return;
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
      finishAction(request);
    }
  };

  const handleActivityFeedScroll = () => {
    const feed = activityFeedRef.current;

    if (!feed || !hasActivityFeedLayout(feed)) {
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

    if (!hasActivityFeedLayout(feed)) {
      return;
    }

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
