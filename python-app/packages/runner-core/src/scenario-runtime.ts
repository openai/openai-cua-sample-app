import { launchBrowserSession, launchPythonRuntime, type PythonRuntime, type ModelObservation, pythonDesktopCapabilities } from "@cua-sample/browser-runtime";
import {
  type BrowserMode,
  type BrowserScreenshotArtifact,
  type RunDetail,
  type RunEventLevel,
  type RunEventType,
  type RunOutcome,
} from "@cua-sample/replay-schema";

import { RunnerCoreError } from "./errors.js";
import { startWorkspaceLabServer } from "./workspace-lab-server.js";

export class RunAbortedError extends Error {
  constructor(message = "Run aborted.") {
    super(message);
    this.name = "RunAbortedError";
  }
}

export type RunExecutionContext = {
  captureScreenshot: (
    session: Awaited<ReturnType<typeof launchBrowserSession>>,
    label: string,
    observation?: ModelObservation,
  ) => Promise<BrowserScreenshotArtifact>;
  completeRun: (options: {
    notes: string[];
    outcome: RunOutcome;
    verificationPassed: boolean;
  }) => Promise<void>;
  detail: RunDetail;
  emitEvent: (input: {
    detail?: string;
    level: RunEventLevel;
    message: string;
    type: RunEventType;
  }) => Promise<void>;
  screenshotDirectory: string;
  signal: AbortSignal;
  stepDelayMs: number;
  syncBrowserState: (
    session: Awaited<ReturnType<typeof launchBrowserSession>>,
  ) => Promise<void>;
};

export interface RunExecutor {
  execute(context: RunExecutionContext): Promise<void>;
}

export type WorkspaceLabSession = Awaited<ReturnType<typeof launchBrowserSession>>;

export type WorkspaceLabExecutionResult = {
  notes: string[];
  verificationMessage: string;
};

type WorkspaceLabFlowOptions = {
  assertOutcome: (session: WorkspaceLabSession) => Promise<void>;
  buildVerificationDetail: (session: WorkspaceLabSession) => Promise<string>;
  loadedScreenshotLabel: string;
  navigationMessage: string;
  runner: (input: {
    labUrl: string;
    session: WorkspaceLabSession;
  }) => Promise<WorkspaceLabExecutionResult>;
  sessionLabel: string;
  verifiedScreenshotLabel: string;
};

const defaultHeadfulHoldMs = 3_500;
const defaultPromptRequestedHoldMs = 5_000;
const maxHeadfulHoldMs = 15_000;

export function assertActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new RunAbortedError();
  }
}

export async function delay(ms: number, signal: AbortSignal) {
  if (signal.aborted) {
    throw new RunAbortedError();
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new RunAbortedError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isVerificationEnabled(context: RunExecutionContext) {
  return context.detail.run.verificationEnabled ?? false;
}

export function validateVerificationPrompt(
  context: RunExecutionContext,
  parsePrompt: (prompt: string) => unknown,
  hint: string,
) {
  if (!isVerificationEnabled(context)) {
    return;
  }

  try {
    parsePrompt(context.detail.run.prompt);
  } catch (error) {
    throw new RunnerCoreError(
      error instanceof Error ? error.message : "Verification prompt is invalid.",
      { code: "invalid_verification_prompt", hint, statusCode: 400 },
    );
  }
}

function extractHeadfulHoldMs(prompt: string, browserMode: BrowserMode) {
  if (browserMode !== "headful") {
    return 0;
  }

  const promptLower = prompt.toLowerCase();
  const durationMatch =
    promptLower.match(/wait\s+(\d+)\s*(seconds?|secs?|s)\b/) ??
    promptLower.match(
      /keep(?:\s+it)?\s+open\s+for\s+(\d+)\s*(seconds?|secs?|s)\b/,
    );

  if (durationMatch) {
    return clamp(Number(durationMatch[1]) * 1_000, 1_000, maxHeadfulHoldMs);
  }

  if (
    promptLower.includes("wait") ||
    promptLower.includes("hold open") ||
    promptLower.includes("keep open") ||
    promptLower.includes("stay open")
  ) {
    return defaultPromptRequestedHoldMs;
  }

  return defaultHeadfulHoldMs;
}

export async function maybeHoldHeadfulBrowserOpen(context: RunExecutionContext) {
  const holdMs = extractHeadfulHoldMs(
    context.detail.run.prompt,
    context.detail.run.browserMode,
  );

  if (holdMs <= 0) {
    return;
  }

  await context.emitEvent({
    detail: `${Math.round(holdMs / 1000)}s operator review window`,
    level: "pending",
    message: "Holding the headful browser session open before teardown.",
    type: "run_progress",
  });
  await delay(holdMs, context.signal);
}

export async function runWorkspaceLabBrowserFlow(
  context: RunExecutionContext,
  options: WorkspaceLabFlowOptions,
) {
  if (context.detail.run.browserMode === "headless" && !pythonDesktopCapabilities.headless) {
    throw new RunnerCoreError("Local PyAutoGUI requires a visible browser.", {
      code: "visible_browser_required", hint: "Use browserMode: headful for local PyAutoGUI execution.", statusCode: 400,
    });
  }
  const labServer = await startWorkspaceLabServer({
    workspacePath: context.detail.workspacePath,
  });
  const labUrl = labServer.urlFor("index.html");
  let session: WorkspaceLabSession | undefined;
  let python: PythonRuntime | undefined;
  let closing: Promise<void> | undefined;
  async function attemptCleanup(steps: Array<() => Promise<void> | undefined>) {
    const errors: unknown[] = [];
    for (const step of steps) {
      try { await step(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const first = errors[0];
      throw Object.assign(new Error(errors.map(error => error instanceof Error ? error.message : String(error)).join("; ")), {
        ...(first instanceof Error && "code" in first ? { code: first.code } : {}),
      });
    }
  }
  function close() {
    return closing ??= attemptCleanup([() => python?.close(), () => session?.close()]);
  }
  async function cleanup() {
    try {
      await attemptCleanup([close, () => labServer.close()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const releaseCode = error instanceof Error && "code" in error &&
        (error.code === "input_release_failed" || error.code === "input_release_timeout")
        ? error.code : undefined;
      throw new RunnerCoreError(`Run cleanup failed: ${releaseCode ? `${releaseCode}: ` : ""}${message}`, {
        code: releaseCode ? "desktop_cleanup_failed" : "cleanup_failed",
        ...(releaseCode ? { hint: "Release held keys and mouse buttons, check desktop input permissions, then restart the runner before starting another run." } : {}),
      });
    }
  }
  function onAbort() {
    // The finally block below awaits this same teardown and reports failures.
    void close().catch(() => undefined);
  }
  try {
    assertActive(context.signal);
    python = await launchPythonRuntime({ signal: context.signal });
    assertActive(context.signal);
    session = await launchBrowserSession({
      browserMode: context.detail.run.browserMode,
      screenshotDir: context.screenshotDirectory,
      startTarget: { kind: "remote_url", label: options.sessionLabel, url: labUrl },
      workspacePath: context.detail.workspacePath,
    });
    if (python) {
      session.execution = python;
      await session.page.bringToFront();
    }
    context.signal.addEventListener("abort", onAbort, { once: true });
    assertActive(context.signal);
    await context.emitEvent({
      detail: labUrl,
      level: "ok",
      message: "HTTP lab server booted from the mutable workspace.",
      type: "lab_started",
    });
    await context.syncBrowserState(session);
    await context.emitEvent({
      detail: session.targetLabel,
      level: "ok",
      message: "Browser session launched and bound to the run.",
      type: "browser_session_started",
    });
    await context.emitEvent({
      detail: (await session.readState()).currentUrl,
      level: "ok",
      message: options.navigationMessage,
      type: "browser_navigated",
    });
    await context.captureScreenshot(session, options.loadedScreenshotLabel);

    const result = await options.runner({ labUrl, session });
    await context.captureScreenshot(session, options.verifiedScreenshotLabel);
    let verificationPassed = false;
    const notes = [...result.notes];

    if (isVerificationEnabled(context)) {
      await options.assertOutcome(session);
      await context.emitEvent({
        detail: await options.buildVerificationDetail(session),
        level: "ok",
        message: result.verificationMessage,
        type: "verification_completed",
      });
      verificationPassed = true;
    } else {
      notes.push("Verification checks were skipped for this run.");
    }

    await maybeHoldHeadfulBrowserOpen(context);
    await context.completeRun({
      notes,
      outcome: "success",
      verificationPassed,
    });
  } finally {
    context.signal.removeEventListener("abort", onAbort);
    await cleanup();
  }
}

export function createLiveResponsesUnavailableError(message: string) {
  return new RunnerCoreError(message, {
    code: "live_mode_unavailable",
    hint:
      "Set OPENAI_API_KEY in the runner environment, then rerun the scenario.",
    statusCode: 400,
  });
}

export async function failLiveResponsesUnavailable(
  context: RunExecutionContext,
  message: string,
) {
  await context.emitEvent({
    detail: context.detail.run.prompt,
    level: "error",
    message,
    type: "run_progress",
  });
  throw createLiveResponsesUnavailableError(message);
}

export function createUnsupportedScenarioError(scenarioId: string) {
  return new RunnerCoreError(`Unsupported public scenario: ${scenarioId}`, {
    code: "unsupported_scenario",
    hint:
      "Use one of the public scenarios from /api/scenarios, or add a new executor through the documented extension points.",
    statusCode: 404,
  });
}
