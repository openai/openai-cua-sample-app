import {
  appendFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { type BrowserObservationSession } from "./browser/session.js";
import {
  browserScreenshotArtifactSchema,
  browserStateSchema,
  runDetailSchema,
  runEventSchema,
  runRecordSchema,
  replayBundleSchema,
  scenarioResetResponseSchema,
  startRunRequestSchema,
  type BrowserScreenshotArtifact,
  type RunDetail,
  type RunEvent,
  type RunEventLevel,
  type RunEventType,
  type RunRecord,
  type ReplayBundle,
  type ScenarioResetResponse,
  type StartRunRequest,
} from "@cua-sample/contracts";
import { getScenarioById } from "./lab-catalog.js";

import { createDefaultRunExecutor } from "./executor-registry.js";
import { RunnerCoreError } from "./errors.js";
import { type RunExecutor } from "./scenario-runtime.js";

type RunSubscriber = (event: RunEvent) => void;
type RunCompletion = {
  notes: string[];
};
type RunEventInput = {
  detail?: string;
  level: RunEventLevel;
  message: string;
  type: RunEventType;
};

type InternalRunContext = {
  abortController: AbortController;
  detail: RunDetail;
  execution?: Promise<void>;
  finalizing?: boolean;
  stopping?: Promise<RunDetail>;
  completion?: RunCompletion;
  subscribers: Set<RunSubscriber>;
};

type RunnerManagerOptions = {
  dataRoot: string;
  executorFactory?: (detail: RunDetail) => RunExecutor;
};
const defaultRunModel = process.env.CUA_DEFAULT_MODEL ?? "gpt-5.6-sol";
const defaultMaxResponseTurns = 24;

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export class RunnerManager {
  private readonly activeRunIds = new Set<string>();
  private readonly dataRoot: string;
  private readonly executorFactory: (detail: RunDetail) => RunExecutor;
  private readonly runContexts = new Map<string, InternalRunContext>();
  private startingRun = false;
  private shuttingDown = false;

  constructor(options: RunnerManagerOptions) {
    this.dataRoot = resolve(options.dataRoot);
    this.executorFactory = options.executorFactory ?? createDefaultRunExecutor;
  }

  async startRun(input: StartRunRequest): Promise<RunDetail> {
    const request = startRunRequestSchema.parse(input);
    if (this.shuttingDown) {
      throw new RunnerCoreError("Runner is shutting down.", {
        code: "runner_shutting_down",
        hint: "Restart the runner before starting another run.",
        statusCode: 503,
      });
    }
    const scenario = getScenarioById(request.scenarioId);

    if (!scenario) {
      throw new RunnerCoreError(`Unknown scenario: ${request.scenarioId}`, {
        code: "unknown_scenario",
        hint: "Pick a scenario from /api/scenarios before starting a run.",
        statusCode: 404,
      });
    }

    const activeRun = this.getActiveRun();

    if (this.startingRun || activeRun) {
      throw new RunnerCoreError(
        activeRun
          ? `Run ${activeRun.detail.run.id} is already active. Stop it before starting another run.`
          : "A run is already starting. Wait for it before starting another run.",
        {
          code: "run_already_active",
          hint: "Stop the active run before starting another scenario.",
          statusCode: 409,
        },
      );
    }

    const runId = randomUUID();
    this.assertValidRunId(runId);
    const startedAt = new Date().toISOString();
    const workspacePath = this.getRunWorkspacePath(runId);
    const runRecord = runRecordSchema.parse({
      browserMode: request.browserMode ?? "headless",
      id: runId,
      labId: scenario.labId,
      maxResponseTurns: request.maxResponseTurns ?? defaultMaxResponseTurns,
      model: request.model ?? defaultRunModel,
      prompt: request.prompt,
      scenarioId: scenario.id,
      startedAt,
      status: "running",
    });

    // Reserve the run slot before the first asynchronous workspace operation.
    this.startingRun = true;
    try {
      await this.ensureBaseDirectories();
      await this.prepareRunWorkspace(scenario.workspaceTemplatePath, workspacePath);

      const detail = runDetailSchema.parse({
        browser: undefined,
        eventStreamUrl: `/api/runs/${runId}/events`,
        events: [],
        replayUrl: `/api/runs/${runId}/replay`,
        run: runRecord,
        scenario,
        workspacePath,
      });

      const context: InternalRunContext = {
        abortController: new AbortController(),
        detail,
        subscribers: new Set(),
      };

      this.runContexts.set(runId, context);
      this.activeRunIds.add(runId);

      await this.initializeRunArtifacts(runId);
      await this.persistContext(context);

      await this.emitEvent(context, {
        detail: `${scenario.title} · ${request.browserMode ?? "headless"} · ${runRecord.maxResponseTurns} turns`,
        level: "ok",
        message: `Run ${runId} started.`,
        type: "run_started",
      });
      await this.emitEvent(context, {
        detail: workspacePath,
        level: "ok",
        message: "Workspace copied into mutable run directory.",
        type: "workspace_prepared",
      });

      context.execution = this.executeRun(context);

      return structuredClone(context.detail);
    } catch (error) {
      this.activeRunIds.delete(runId);
      this.runContexts.delete(runId);
      throw error;
    } finally {
      this.startingRun = false;
    }
  }

  async getRunDetail(runId: string): Promise<RunDetail> {
    this.assertValidRunId(runId);
    const inMemory = this.runContexts.get(runId);

    if (inMemory) {
      return structuredClone(inMemory.detail);
    }

    return this.readRunDetail(runId);
  }

  async getActiveRunDetail(): Promise<RunDetail | null> {
    // Admission starts before the context is allocated. Do not report idle
    // while a start already owns the run slot.
    while (this.startingRun) await sleep(10);
    const active = this.getActiveRun();
    return active ? structuredClone(active.detail) : null;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    // A start already past admission must finish registering its context first.
    while (this.startingRun) {
      await sleep(10);
    }
    await Promise.all(
      [...this.activeRunIds].map((runId) => this.stopRun(runId, "Runner shutting down.")),
    );
  }

  async getReplayBundle(runId: string): Promise<ReplayBundle> {
    this.assertValidRunId(runId);
    const replayJsonPath = this.getRunReplayPath(runId);

    try {
      const stored: unknown = JSON.parse(await readFile(replayJsonPath, "utf8"));
      const version = typeof stored === "object" && stored !== null && "version" in stored
        ? stored.version
        : undefined;
      if (version !== 3) {
        throw new RunnerCoreError("This saved replay uses an unsupported version.", {
          code: "unsupported_replay_version",
          hint: "Start a new run to create a version 3 replay. Existing replay files have not been changed.",
          statusCode: 409,
        });
      }
      return replayBundleSchema.parse(stored);
    } catch (error) {
      throw this.wrapMissingRunError(runId, error);
    }
  }

  subscribe(runId: string, subscriber: RunSubscriber) {
    this.assertValidRunId(runId);
    const context = this.runContexts.get(runId);

    if (!context) {
      throw new RunnerCoreError(`Run ${runId} is not active in this process.`, {
        code: "run_not_active",
        hint: "Open the persisted run detail instead of the live event stream.",
        statusCode: 404,
      });
    }

    context.subscribers.add(subscriber);

    return () => {
      context.subscribers.delete(subscriber);
    };
  }

  async stopRun(runId: string, reason = "Operator requested stop."): Promise<RunDetail> {
    this.assertValidRunId(runId);
    const context = this.runContexts.get(runId);

    if (!context) {
      const persisted = await this.readRunDetail(runId);

      if (persisted.run.status === "running") {
        throw new RunnerCoreError(
          `Run ${runId} exists on disk but is not active in this runner process.`,
          {
            code: "run_not_active",
            hint:
              "The run is no longer active in this process. Restart the runner or inspect the persisted replay bundle.",
            statusCode: 409,
          },
        );
      }

      return persisted;
    }

    if (context.stopping) {
      return context.stopping;
    }
    if (context.finalizing || context.detail.run.status !== "running") {
      await context.execution;
      return structuredClone(context.detail);
    }

    context.abortController.abort();
    context.stopping = this.finishStoppingRun(context, reason);
    return context.stopping;
  }

  private async finishStoppingRun(context: InternalRunContext, reason: string): Promise<RunDetail> {
    // Do not advertise cancellation until browser and worker teardown has finished.
    try {
      await context.execution;
      await this.publishTerminalRun(context, {
        notes: [reason], status: "cancelled",
      }, {
        detail: reason, level: "warn", message: "Run cancelled before completion.", type: "run_cancelled",
      });
      return structuredClone(context.detail);
    } finally {
      this.activeRunIds.delete(context.detail.run.id);
    }
  }

  async resetScenario(scenarioId: string): Promise<ScenarioResetResponse> {
    const scenario = getScenarioById(scenarioId);

    if (!scenario) {
      throw new RunnerCoreError(`Unknown scenario: ${scenarioId}`, {
        code: "unknown_scenario",
        hint: "Pick a scenario from /api/scenarios before resetting it.",
        statusCode: 404,
      });
    }

    let cancelledRunId: string | undefined;

    for (const activeRunId of this.activeRunIds) {
      const activeRun = this.runContexts.get(activeRunId);

      if (!activeRun || activeRun.detail.run.scenarioId !== scenarioId) {
        continue;
      }

      const stopped = await this.stopRun(activeRunId, "Scenario reset requested.");
      cancelledRunId = stopped.run.id;
      break;
    }

    return scenarioResetResponseSchema.parse({
      cancelledRunId,
      resetAt: new Date().toISOString(),
      scenarioId,
    });
  }

  private buildReplayBundle(detail: RunDetail): ReplayBundle {
    const runId = detail.run.id;

    return {
      artifacts: {
        eventsPath: this.getRunEventsPath(runId),
        replayPath: this.getRunReplayPath(runId),
        runPath: this.getRunRecordPath(runId),
        screenshotsDirectory: this.getRunScreenshotsDirectory(runId),
        workspacePath: detail.workspacePath,
      },
      browser: detail.browser ? structuredClone(detail.browser) : undefined,
      events: structuredClone(detail.events),
      run: structuredClone(detail.run),
      scenario: structuredClone(detail.scenario),
      version: 3,
    };
  }

  private buildTerminalRunRecord(
    run: RunRecord,
    options: {
      notes: string[];
      status: Extract<RunRecord["status"], "completed" | "cancelled" | "failed">;
    },
  ): RunRecord {
    const completedAt = new Date().toISOString();
    const startedAt = new Date(run.startedAt).getTime();
    const endedAt = new Date(completedAt).getTime();
    const durationMs = Math.max(0, endedAt - startedAt);

    return {
      ...run,
      completedAt,
      durationMs,
      status: options.status,
      summary: {
        notes: options.notes,
        screenshotCount: run.summary?.screenshotCount ?? 0,
        stepCount: run.summary?.stepCount ?? 0,
      },
    };
  }

  private async captureScreenshot(
    context: InternalRunContext,
    session: BrowserObservationSession,
    label: string,
  ): Promise<BrowserScreenshotArtifact> {
    const snapshot = await session.captureScreenshot(label);
    const screenshots = context.detail.browser?.screenshots ?? [];
    const artifact = browserScreenshotArtifactSchema.parse({
      capturedAt: snapshot.capturedAt,
      id: snapshot.id,
      label: snapshot.label,
      mimeType: snapshot.mimeType,
      pageTitle: snapshot.pageTitle,
      pageUrl: snapshot.currentUrl,
      path: snapshot.path,
      url: this.getRunScreenshotUrl(context.detail.run.id, snapshot.path),
    });

    context.detail.browser = browserStateSchema.parse({
      currentUrl: snapshot.currentUrl,
      mode: session.mode,
      pageTitle: snapshot.pageTitle,
      screenshots: [...screenshots, artifact],
      targetLabel: session.targetLabel,
      viewport: session.viewport,
    });

    await this.emitEvent(context, {
      detail: artifact.url,
      level: "ok",
      message: `Screenshot captured (${label}).`,
      type: "screenshot_captured",
    });

    return artifact;
  }

  private async completeRun(context: InternalRunContext, options: RunCompletion) {
    // The executor still has its finally/cleanup work to do. Publish success
    // only once execute() has returned and all owned resources are released.
    if (this.ensureRunIsActive(context)) context.completion = options;
  }

  private ensureRunIsActive(context: InternalRunContext) {
    return (
      context.detail.run.status === "running" &&
      !context.abortController.signal.aborted
    );
  }

  private async executeRun(context: InternalRunContext) {
    try {
      const executor = this.executorFactory(context.detail);
      await executor.execute({
        captureScreenshot: (session, label) =>
          this.captureScreenshot(context, session, label),
        completeRun: (options) => this.completeRun(context, options),
        detail: context.detail,
        emitEvent: (input) => this.emitEvent(context, input),
        screenshotDirectory: this.getRunScreenshotsDirectory(context.detail.run.id),
        signal: context.abortController.signal,
        syncBrowserState: (session) => this.syncBrowserState(context, session),
      });
      if (context.abortController.signal.aborted) return;
      context.finalizing = true;
      if (!context.completion) throw new Error("Executor returned without completing the run.");
      await this.publishTerminalRun(context, { ...context.completion, status: "completed" }, {
        detail: context.detail.replayUrl,
        level: "ok",
        message: "Run finished and replay bundle persisted.",
        type: "run_completed",
      });
    } catch (error) {
      if (context.abortController.signal.aborted) return;
      context.finalizing = true;
      await this.failRun(context, error);
    } finally {
      // Stop owns the slot through cancellation publication; other paths have
      // finished both executor cleanup and terminal publication at this point.
      if (!context.stopping) this.activeRunIds.delete(context.detail.run.id);
    }
  }

  private async failRun(context: InternalRunContext, error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown execution failure.";
    const runnerError = error instanceof RunnerCoreError ? error : null;
    const notes = [
      message,
      ...(runnerError ? [`Error code: ${runnerError.code}`] : []),
      ...(runnerError?.hint ? [`Hint: ${runnerError.hint}`] : []),
    ];

    await this.publishTerminalRun(context, {
      notes, status: "failed",
    }, {
      detail: runnerError?.hint ? `${message} Hint: ${runnerError.hint}` : message,
      level: "error",
      message: "Run failed during execution.",
      type: "run_failed",
    });
  }

  private async publishTerminalRun(
    context: InternalRunContext,
    options: RunCompletion & { status: "completed" | "failed" | "cancelled" },
    event: RunEventInput,
  ) {
    const run = this.buildTerminalRunRecord(context.detail.run, options);
    try {
      await this.emitEvent(context, event, run);
    } catch (error) {
      // A failed success publication becomes a failed run. If even the failure
      // cannot be saved, preserve a truthful live result and keep HTTP/SSE alive.
      if (options.status === "completed") throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not persist terminal run ${run.id}:`, error);
      const failedRun = this.buildTerminalRunRecord(run, {
        notes: [...options.notes, `Run artifacts could not be persisted: ${message}`],
        status: "failed",
      });
      const failure = this.createRunEvent(context, {
        detail: message, level: "error", message: "Run artifacts could not be persisted.", type: "run_failed",
      });
      context.detail.run = failedRun;
      context.detail.events.push(failure);
      this.updateSummaryCounts(context.detail);
      this.notifySubscribers(context, failure);
    }
  }

  private getActiveRun() {
    for (const runId of this.activeRunIds) {
      const context = this.runContexts.get(runId);

      if (context) {
        return context;
      }

      this.activeRunIds.delete(runId);
    }

    return null;
  }

  private getRunDirectory(runId: string) {
    this.assertValidRunId(runId);
    return join(this.dataRoot, "runs", runId);
  }

  private assertValidRunId(runId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new RunnerCoreError("Invalid run ID.", {
        code: "invalid_run_id",
        hint: "Use the run ID returned when starting a run.",
        statusCode: 400,
      });
    }
  }

  private getRunEventsPath(runId: string) {
    return join(this.getRunDirectory(runId), "events.jsonl");
  }

  private getRunRecordPath(runId: string) {
    return join(this.getRunDirectory(runId), "run.json");
  }

  private getRunReplayPath(runId: string) {
    return join(this.getRunDirectory(runId), "replay.json");
  }

  private getRunScreenshotsDirectory(runId: string) {
    return join(this.getRunDirectory(runId), "screenshots");
  }

  private getRunScreenshotUrl(runId: string, path: string) {
    return `/api/runs/${runId}/artifacts/screenshots/${basename(path)}`;
  }

  private getRunWorkspacePath(runId: string) {
    return join(this.dataRoot, "workspaces", runId);
  }

  private async ensureBaseDirectories() {
    await mkdir(join(this.dataRoot, "runs"), { recursive: true });
    await mkdir(join(this.dataRoot, "workspaces"), { recursive: true });
  }

  private createRunEvent(context: InternalRunContext, input: RunEventInput) {
    return runEventSchema.parse({
      createdAt: new Date().toISOString(),
      detail: input.detail,
      id: `${context.detail.run.id}:${context.detail.events.length}`,
      level: input.level,
      message: input.message,
      runId: context.detail.run.id,
      sequence: context.detail.events.length,
      type: input.type,
    });
  }

  private async emitEvent(context: InternalRunContext, input: RunEventInput, terminalRun?: RunRecord) {
    const event = this.createRunEvent(context, input);
    // Keep terminal state private until its complete replay has been saved.
    // Progress events reserve their sequence immediately, as before.
    const detail = terminalRun
      ? { ...context.detail, run: terminalRun, events: [...context.detail.events, event] }
      : context.detail;
    if (!terminalRun) detail.events.push(event);

    await appendFile(
      this.getRunEventsPath(context.detail.run.id),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
    await this.persistContext({ ...context, detail });
    if (terminalRun) Object.assign(context.detail, detail);
    this.notifySubscribers(context, event);
  }

  private notifySubscribers(context: InternalRunContext, event: RunEvent) {
    for (const subscriber of context.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        console.error(`Run event subscriber failed for ${context.detail.run.id}:`, error);
      }
    }
  }

  private async initializeRunArtifacts(runId: string) {
    const runDir = this.getRunDirectory(runId);

    await mkdir(runDir, { recursive: true });
    await mkdir(this.getRunScreenshotsDirectory(runId), { recursive: true });
    await writeFile(this.getRunEventsPath(runId), "", "utf8");
  }

  private updateSummaryCounts(detail: RunDetail) {
    if (detail.run.summary) {
      detail.run.summary.screenshotCount = detail.browser?.screenshots.length ?? 0;
      detail.run.summary.stepCount = detail.events.length;
    }
  }

  private async persistContext(context: InternalRunContext) {
    const runId = context.detail.run.id;
    this.updateSummaryCounts(context.detail);

    await mkdir(dirname(this.getRunRecordPath(runId)), { recursive: true });
    await this.writeSnapshot(
      this.getRunRecordPath(runId),
      JSON.stringify(context.detail.run, null, 2),
    );
    await this.writeSnapshot(
      this.getRunReplayPath(runId),
      JSON.stringify(this.buildReplayBundle(context.detail), null, 2),
    );
  }

  private async writeSnapshot(path: string, contents: string) {
    // Publish complete snapshots so readers never observe a truncated JSON file.
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, contents, "utf8");
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async prepareRunWorkspace(templatePath: string, workspacePath: string) {
    await rm(workspacePath, { force: true, recursive: true });
    await mkdir(dirname(workspacePath), { recursive: true });
    await cp(templatePath, workspacePath, { recursive: true });
  }

  private async readRunDetail(runId: string): Promise<RunDetail> {
    try {
      // replay.json is published last and contains one consistent snapshot.
      // The separate run record and event log may be ahead after a write fails.
      const replayBundle = await this.getReplayBundle(runId);
      const run = runRecordSchema.parse(replayBundle.run);
      const scenario = getScenarioById(run.scenarioId);

      if (!scenario) {
        throw new RunnerCoreError(
          `Run ${runId} references unknown scenario ${run.scenarioId}.`,
          {
            code: "unknown_scenario",
            hint: "The run references a scenario that is not registered in this build.",
            statusCode: 500,
          },
        );
      }

      return runDetailSchema.parse({
        browser: replayBundle.browser,
        eventStreamUrl: `/api/runs/${runId}/events`,
        events: replayBundle.events,
        replayUrl: `/api/runs/${runId}/replay`,
        run,
        scenario,
        workspacePath: replayBundle.artifacts.workspacePath,
      });
    } catch (error) {
      throw this.wrapMissingRunError(runId, error);
    }
  }

  private async syncBrowserState(
    context: InternalRunContext,
    session: BrowserObservationSession,
  ) {
    const state = await session.readState();

    context.detail.browser = browserStateSchema.parse({
      currentUrl: state.currentUrl,
      mode: session.mode,
      pageTitle: state.pageTitle,
      screenshots: context.detail.browser?.screenshots ?? [],
      targetLabel: session.targetLabel,
      viewport: session.viewport,
    });
    await this.persistContext(context);
  }

  private wrapMissingRunError(runId: string, error: unknown) {
    if (error instanceof RunnerCoreError) {
      return error;
    }

    return new RunnerCoreError(`Run ${runId} was not found.`, {
      code: "run_not_found",
      hint: "Start a new run or check that the replay artifacts still exist on disk.",
      statusCode: 404,
    });
  }
}
