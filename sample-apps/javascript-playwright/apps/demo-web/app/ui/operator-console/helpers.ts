import {
  runnerErrorResponseSchema,
  type BrowserScreenshotArtifact,
  type ResponseTurnBudget,
  type RunDetail,
  type RunEvent,
  type RunEventLevel,
  type ScenarioManifest,
} from "@cua-sample/replay-schema";

import type {
  ActivityItem,
  LogEntry,
  RunnerIssue,
  TranscriptEntry,
} from "./types";

export const defaultRunModel =
  process.env.NEXT_PUBLIC_CUA_DEFAULT_MODEL ?? "gpt-5.6-sol";
export const defaultMaxResponseTurns = Number(
  process.env.NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS ?? "24",
) as ResponseTurnBudget;
export const browserHelpText =
  "Headless runs the browser off-screen. Visible opens the browser window so you can watch the session live as it runs.";
export const turnBudgetHelpText =
  "Caps how many model turns the runner can use before stopping the run. Higher budgets allow longer plans but take more time.";
export const verificationHelpText =
  "Runs the scenario's built-in checks after the model stops. Leave this off to treat the model's completed action loop as the success condition.";
export const runnerUnavailableHint =
  "Start `pnpm dev` or `OPENAI_API_KEY=... pnpm dev:runner`, then refresh the page.";

function titleForIssueCode(code: string) {
  switch (code) {
    case "runner_unavailable":
      return "Runner unavailable";
    case "missing_api_key":
      return "Runner missing API key";
    case "live_mode_unavailable":
      return "Live mode unavailable";
    case "run_already_active":
      return "Run already active";
    case "invalid_request":
      return "Invalid request";
    default:
      return humanizeToken(code);
  }
}

export function formatClock(value: string) {
  const date = new Date(value);

  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function humanizeToken(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatRunnerIssueMessage(issue: RunnerIssue) {
  return issue.hint ? `${issue.error} ${issue.hint}` : issue.error;
}

export function createRunnerIssue(
  code: string,
  error: string,
  hint?: string,
): RunnerIssue {
  return {
    code,
    error,
    ...(hint ? { hint } : {}),
    title: titleForIssueCode(code),
  };
}

export function parseRunnerIssue(value: unknown) {
  const parsed = runnerErrorResponseSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  return createRunnerIssue(parsed.data.code, parsed.data.error, parsed.data.hint);
}

export function createRunnerUnavailableIssue(detail?: string) {
  return createRunnerIssue(
    "runner_unavailable",
    detail
      ? `The operator console could not reach the runner. ${detail}`
      : "The operator console could not reach the runner.",
    runnerUnavailableHint,
  );
}

export function deriveRunFailureIssue(runDetail: RunDetail | null) {
  if (!runDetail || runDetail.run.status !== "failed") {
    return null;
  }

  const notes = runDetail.run.summary?.notes ?? [];
  const message = notes[0] ?? "Run failed during execution.";
  const code = notes.find((note) => note.startsWith("Error code: "))?.slice(12);
  const hint = notes.find((note) => note.startsWith("Hint: "))?.slice(6);

  return createRunnerIssue(code ?? "run_failed", message, hint);
}

export function scenarioTargetDisplay(scenario: ScenarioManifest | null) {
  if (!scenario) {
    return "Runner unavailable";
  }

  return scenario.startTarget.kind === "remote_url"
    ? scenario.startTarget.url
    : scenario.startTarget.path;
}

export function createManualLog(
  event: string,
  detail: string,
  level: RunEventLevel,
): LogEntry {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    detail,
    event,
    key: `manual-${event}-${now}`,
    level,
    time: formatClock(now),
  };
}

export function createManualTranscript(
  lane: TranscriptEntry["lane"],
  speaker: string,
  body: string,
): TranscriptEntry {
  const now = new Date().toISOString();

  return {
    body,
    createdAt: now,
    key: `manual-${speaker}-${now}`,
    lane,
    speaker,
    time: formatClock(now),
  };
}

function formatUrlLabel(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;

    return `${url.hostname}${path}${url.search}`;
  } catch {
    return value;
  }
}

function parseToolPayload(detail: string | undefined) {
  if (!detail) {
    return null;
  }

  const match = detail.match(/^([a-z_]+)\s+(\{[\s\S]+\})$/i);

  if (!match) {
    return null;
  }

  try {
    const label = match[1];
    const payloadText = match[2];

    if (!label || !payloadText) {
      return null;
    }

    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const code =
      typeof payload.code === "string" && label === "exec_js"
        ? payload.code
        : undefined;
    const detailPayload = { ...payload };

    if (code) {
      delete detailPayload.code;
    }

    return {
      ...(code ? { code } : {}),
      ...(Object.keys(detailPayload).length > 0
        ? { detail: JSON.stringify(detailPayload, null, 2) }
        : {}),
      label,
      payload: detailPayload,
    };
  } catch {
    return null;
  }
}

function describeToolCall(label: string, payload: Record<string, unknown>) {
  switch (label) {
    case "exec_js":
      return "Run browser script";
    default:
      return Object.keys(payload).length > 0
        ? humanizeToken(label)
        : "Tool requested";
  }
}

function summarizeToolCall(label: string, payload: Record<string, unknown>) {
  switch (label) {
    case "exec_js":
      return "Model is using the browser runtime directly.";
    default:
      return Object.keys(payload).length > 0
        ? JSON.stringify(payload)
        : "Model requested a workspace helper tool.";
  }
}

function findRelatedScreenshot(
  detail: string | undefined,
  screenshots: BrowserScreenshotArtifact[],
) {
  if (!detail) {
    return null;
  }

  return screenshots.find((screenshot) => screenshot.url === detail) ?? null;
}

function formatScreenshotSummary(screenshot: BrowserScreenshotArtifact) {
  const page = screenshot.pageTitle?.trim() || formatUrlLabel(screenshot.pageUrl);

  return `${page} · ${formatClock(screenshot.capturedAt)}`;
}

function withOptionalDetail(detail: string | undefined) {
  return detail ? { detail } : {};
}

export function mapRunEventToActivity(
  event: RunEvent,
  screenshots: BrowserScreenshotArtifact[],
): ActivityItem {
  const parsedPayload = parseToolPayload(event.detail);
  const relatedScreenshot = findRelatedScreenshot(event.detail, screenshots);

  switch (event.type) {
    case "run_started":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run started",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "workspace_prepared":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Workspace ready",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "lab_started":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Lab runtime started",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "browser_session_started":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "observe",
        headline: "Browser session started",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "browser_navigated":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "observe",
        headline: "Navigation",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ? formatUrlLabel(event.detail) : event.message,
        time: formatClock(event.createdAt),
      };
    case "function_call_requested":
      return {
        createdAt: event.createdAt,
        ...(parsedPayload?.code ? { code: parsedPayload.code } : {}),
        ...(parsedPayload?.detail
          ? { detail: parsedPayload.detail }
          : event.detail
            ? { detail: event.detail }
            : {}),
        family: "tool",
        headline: parsedPayload
          ? describeToolCall(parsedPayload.label, parsedPayload.payload)
          : "Tool requested",
        key: `activity-${event.id}`,
        level: event.level,
        summary: parsedPayload
          ? summarizeToolCall(parsedPayload.label, parsedPayload.payload)
          : event.message,
        time: formatClock(event.createdAt),
      };
    case "function_call_completed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "tool",
        headline: event.detail
          ? `${humanizeToken(event.detail)} complete`
          : "Tool completed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.message,
        time: formatClock(event.createdAt),
      };
    case "screenshot_captured":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(
          relatedScreenshot
            ? JSON.stringify(
                {
                  capturedAt: relatedScreenshot.capturedAt,
                  label: relatedScreenshot.label,
                  pageTitle: relatedScreenshot.pageTitle,
                  pageUrl: relatedScreenshot.pageUrl,
                },
                null,
                2,
              )
            : event.detail,
        ),
        family: "snapshot",
        headline: relatedScreenshot
          ? `Captured ${humanizeToken(relatedScreenshot.label)}`
          : "Screenshot captured",
        key: `activity-${event.id}`,
        level: event.level,
        ...(relatedScreenshot ? { screenshotId: relatedScreenshot.id } : {}),
        summary: relatedScreenshot
          ? formatScreenshotSummary(relatedScreenshot)
          : event.message,
        time: formatClock(event.createdAt),
      };
    case "verification_completed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "verify",
        headline: "Verification completed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "run_completed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run completed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.message,
        time: formatClock(event.createdAt),
      };
    case "run_failed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run failed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "run_cancelled":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run cancelled",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "run_progress":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family:
          event.message === "Model returned a final response."
            ? "verify"
            : "system",
        headline: event.message.replace(/\.$/, ""),
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    default:
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: humanizeToken(event.type),
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
  }
}

export function mapManualLogToActivity(entry: LogEntry): ActivityItem {
  return {
    createdAt: entry.createdAt,
    detail: entry.detail,
    family: "system",
    headline: humanizeToken(entry.event),
    key: `activity-${entry.key}`,
    level: entry.level,
    summary: entry.detail,
    time: entry.time,
  };
}

export function mapManualTranscriptToActivity(entry: TranscriptEntry): ActivityItem {
  return {
    createdAt: entry.createdAt,
    detail: entry.speaker,
    family: entry.lane === "verification" ? "verify" : "operator",
    headline: humanizeToken(entry.speaker),
    key: `activity-${entry.key}`,
    level: entry.lane === "verification" ? "ok" : "pending",
    summary: entry.body,
    time: entry.time,
  };
}

export function activityFamilyLabel(family: ActivityItem["family"]) {
  switch (family) {
    case "observe":
      return "Observe";
    case "operator":
      return "Operator";
    case "snapshot":
      return "Snapshot";
    case "tool":
      return "Tool";
    case "verify":
      return "Verify";
    default:
      return "System";
  }
}
