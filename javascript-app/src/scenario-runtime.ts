import { fileURLToPath } from "node:url";
import { launchJavaScriptSession, type JavaScriptSession } from "./browser/javascript-process.js";
import { type BrowserObservationSession } from "./browser/session.js";
import {
  type BrowserMode,
  type BrowserScreenshotArtifact,
  type RunDetail,
  type RunEventLevel,
  type RunEventType,
} from "@cua-sample/contracts";

import { RunnerCoreError } from "./errors.js";
import { startWorkspaceLabServer } from "./workspace-lab-server.js";

class RunAbortedError extends Error {
  constructor(message = "Run aborted.") {
    super(message);
    this.name = "RunAbortedError";
  }
}

export type RunExecutionContext = {
  captureScreenshot: (
    session: BrowserObservationSession,
    label: string,
  ) => Promise<BrowserScreenshotArtifact>;
  completeRun: (options: {
    notes: string[];
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
  syncBrowserState: (
    session: BrowserObservationSession,
  ) => Promise<void>;
};

export interface RunExecutor {
  execute(context: RunExecutionContext): Promise<void>;
}

type WorkspaceLabExecutionResult = {
  notes: string[];
};

type WorkspaceLabFlowOptions = {
  loadedScreenshotLabel: string;
  navigationMessage: string;
  runner: (input: {
    labUrl: string;
    session: JavaScriptSession;
  }) => Promise<WorkspaceLabExecutionResult>;
  sessionLabel: string;
  finalScreenshotLabel: string;
};

const defaultHeadfulHoldMs = 3_500;
const defaultPromptRequestedHoldMs = 5_000;
const maxHeadfulHoldMs = 15_000;

function assertActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new RunAbortedError();
  }
}

async function delay(ms: number, signal: AbortSignal) {
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

async function maybeHoldHeadfulBrowserOpen(context: RunExecutionContext) {
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
  const labServer = await startWorkspaceLabServer({
    workspacePath: context.detail.workspacePath,
  });
  const labUrl = labServer.urlFor("index.html");
  let session: JavaScriptSession | undefined;
  try {
    assertActive(context.signal);
    session = await launchJavaScriptSession({
      browserMode: context.detail.run.browserMode,
      screenshotDir: context.screenshotDirectory,
      targetLabel: options.sessionLabel,
      url: labUrl,
      workerPath: fileURLToPath(new URL(
        import.meta.url.endsWith(".ts") ? "./javascript-worker.ts" : "./javascript-worker.js",
        import.meta.url,
      )),
      signal: context.signal,
    });
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
    await context.captureScreenshot(session, options.finalScreenshotLabel);

    await maybeHoldHeadfulBrowserOpen(context);
    await context.completeRun({
      notes: result.notes,
    });
  } finally {
    try {
      await session?.close();
    } finally {
      await labServer.close();
    }
  }
}

export function createUnsupportedScenarioError(scenarioId: string) {
  return new RunnerCoreError(`Unsupported public scenario: ${scenarioId}`, {
    code: "unsupported_scenario",
    hint:
      "Use one of the public scenarios from /api/scenarios, or add a new executor through the documented extension points.",
    statusCode: 404,
  });
}
