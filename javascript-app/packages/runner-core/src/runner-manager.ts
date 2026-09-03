import {
  appendFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { type BrowserObservationSession } from "@cua-sample/browser-runtime";
import {
  browserScreenshotArtifactSchema,
  browserStateSchema,
  runDetailSchema,
  runEventSchema,
  runRecordSchema,
  scenarioWorkspaceStateSchema,
  startRunRequestSchema,
  type BrowserScreenshotArtifact,
  type RunDetail,
  type RunEvent,
  type RunEventLevel,
  type RunEventType,
  type RunOutcome,
  type RunRecord,
  type ScenarioWorkspaceState,
  type StartRunRequest,
} from "@cua-sample/replay-schema";
import { getScenarioById } from "@cua-sample/scenario-kit";

import { createDefaultRunExecutor } from "./executor-registry.js";
import { RunnerCoreError } from "./errors.js";
import { RunAbortedError, type RunExecutor } from "./scenario-runtime.js";

type RunSubscriber = (event: RunEvent) => void;

type InternalRunContext = {
  abortController: AbortController;
  detail: RunDetail;
  execution?: Promise<void>;
  stopping?: Promise<RunDetail>;
  subscribers: Set<RunSubscriber>;
};

type RunnerManagerOptions = {
  dataRoot: string;
  executorFactory?: (detail: RunDetail) => RunExecutor;
  idGenerator?: () => string;
  now?: () => Date;
  stepDelayMs?: number;
};

type ReplayBundle = {
  artifacts: {
    commandResultsDirectory: string;
    eventsPath: string;
    patchesDirectory: string;
    replayPath: string;
    runPath: string;
    screenshotsDirectory: string;
    workspacePath: string;
  };
  browser?: RunDetail["browser"];
  events: RunEvent[];
  run: RunRecord;
  scenario: RunDetail["scenario"];
  version: 2;
};

const defaultStepDelayMs = 650;
const defaultRunModel = process.env.CUA_DEFAULT_MODEL ?? "gpt-5.6-sol";
const defaultMaxResponseTurns = 24;

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export class RunnerManager {
  private readonly activeRunIds = new Set<string>();
  private readonly dataRoot: string;
  private readonly executorFactory: (detail: RunDetail) => RunExecutor;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;
  private readonly runContexts = new Map<string, InternalRunContext>();
  private readonly scenarioWorkspaceStates = new Map<string, ScenarioWorkspaceState>();
  private readonly stepDelayMs: number;
  private startingRun = false;
  private shuttingDown = false;

  constructor(options: RunnerManagerOptions) {
    this.dataRoot = resolve(options.dataRoot);
    this.executorFactory = options.executorFactory ?? createDefaultRunExecutor;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.stepDelayMs = options.stepDelayMs ?? defaultStepDelayMs;
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

    const runId = this.idGenerator();
    this.assertValidRunId(runId);
    const startedAt = this.now().toISOString();
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
      verificationEnabled: request.verificationEnabled ?? false,
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
        detail: `${scenario.title} · ${request.browserMode ?? "headless"} · ${runRecord.maxResponseTurns ?? defaultMaxResponseTurns} turns`,
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
      return JSON.parse(await readFile(replayJsonPath, "utf8")) as ReplayBundle;
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
    if (context.detail.run.status !== "running") {
      await context.execution;
      return structuredClone(context.detail);
    }

    context.abortController.abort();
    context.stopping = this.finishStoppingRun(context, reason);
    return context.stopping;
  }

  private async finishStoppingRun(context: InternalRunContext, reason: string): Promise<RunDetail> {
    // Do not advertise cancellation until browser and worker teardown has finished.
    await context.execution;
    const runId = context.detail.run.id;
    const artifactCounts = await this.readArtifactCounts(runId);
    context.detail.run = this.buildTerminalRunRecord(context.detail.run, {
      commandCount: artifactCounts.commandCount,
      notes: [reason],
      outcome: "partial",
      patchCount: artifactCounts.patchCount,
      status: "cancelled",
      verificationPassed: false,
    });

    await this.emitEvent(context, {
      detail: reason,
      level: "warn",
      message: "Run cancelled before completion.",
      type: "run_cancelled",
    });

    return structuredClone(context.detail);
  }

  async resetScenario(scenarioId: string): Promise<ScenarioWorkspaceState> {
    const scenario = getScenarioById(scenarioId);

    if (!scenario) {
      throw new RunnerCoreError(`Unknown scenario: ${scenarioId}`, {
        code: "unknown_scenario",
        hint: "Pick a scenario from /api/scenarios before resetting a workspace.",
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

    const workspacePath = this.getScenarioWorkspacePath(scenarioId);

    await rm(workspacePath, { force: true, recursive: true });
    await this.prepareRunWorkspace(scenario.workspaceTemplatePath, workspacePath);

    const state = scenarioWorkspaceStateSchema.parse({
      cancelledRunId,
      resetAt: this.now().toISOString(),
      scenarioId,
      workspacePath,
    });

    this.scenarioWorkspaceStates.set(scenarioId, state);

    await writeFile(
      join(workspacePath, ".workspace-state.json"),
      JSON.stringify(state, null, 2),
      "utf8",
    );

    return structuredClone(state);
  }

  async waitForRunStatus(
    runId: string,
    expectedStatus: RunRecord["status"],
    timeoutMs = 4_000,
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const detail = await this.getRunDetail(runId);

      if (detail.run.status === expectedStatus) {
        return detail;
      }

      await sleep(10);
    }

    throw new RunnerCoreError(
      `Timed out waiting for run ${runId} to reach ${expectedStatus}.`,
      {
        code: "run_status_timeout",
        hint: "Increase the wait timeout or inspect the persisted run detail.",
        statusCode: 504,
      },
    );
  }

  private buildReplayBundle(detail: RunDetail): ReplayBundle {
    const runId = detail.run.id;

    return {
      artifacts: {
        commandResultsDirectory: join(this.getRunDirectory(runId), "command-results"),
        eventsPath: this.getRunEventsPath(runId),
        patchesDirectory: join(this.getRunDirectory(runId), "patches"),
        replayPath: this.getRunReplayPath(runId),
        runPath: this.getRunRecordPath(runId),
        screenshotsDirectory: this.getRunScreenshotsDirectory(runId),
        workspacePath: detail.workspacePath,
      },
      browser: detail.browser ? structuredClone(detail.browser) : undefined,
      events: structuredClone(detail.events),
      run: structuredClone(detail.run),
      scenario: structuredClone(detail.scenario),
      version: 2,
    };
  }

  private buildTerminalRunRecord(
    run: RunRecord,
    options: {
      commandCount: number;
      notes: string[];
      outcome: RunOutcome;
      patchCount: number;
      status: Extract<RunRecord["status"], "completed" | "cancelled" | "failed">;
      verificationPassed: boolean;
    },
  ): RunRecord {
    const completedAt = this.now().toISOString();
    const startedAt = new Date(run.startedAt).getTime();
    const endedAt = new Date(completedAt).getTime();
    const durationMs = Math.max(0, endedAt - startedAt);

    return {
      ...run,
      completedAt,
      durationMs,
      status: options.status,
      summary: {
        commandCount: options.commandCount,
        notes: options.notes,
        outcome: options.outcome,
        patchCount: options.patchCount,
        screenshotCount: run.summary?.screenshotCount ?? 0,
        stepCount: run.summary?.stepCount ?? 0,
        verificationPassed: options.verificationPassed,
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

  private async completeRun(
    context: InternalRunContext,
    options: {
      notes: string[];
      outcome: RunOutcome;
      verificationPassed: boolean;
    },
  ) {
    if (!this.ensureRunIsActive(context)) {
      return;
    }

    const artifactCounts = await this.readArtifactCounts(context.detail.run.id);
    if (!this.ensureRunIsActive(context)) {
      return;
    }
    context.detail.run = this.buildTerminalRunRecord(context.detail.run, {
      commandCount: artifactCounts.commandCount,
      notes: options.notes,
      outcome: options.outcome,
      patchCount: artifactCounts.patchCount,
      status: "completed",
      verificationPassed: options.verificationPassed,
    });

    await this.emitEvent(context, {
      detail: context.detail.replayUrl,
      level: "ok",
      message: "Run completed and replay bundle persisted.",
      type: "run_completed",
    });
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
        stepDelayMs: this.stepDelayMs,
        syncBrowserState: (session) => this.syncBrowserState(context, session),
      });
    } catch (error) {
      if (
        error instanceof RunAbortedError ||
        context.abortController.signal.aborted ||
        context.detail.run.status !== "running"
      ) {
        return;
      }

      await this.failRun(context, error);
    } finally {
      // Executors release their browser resources before this slot is reused.
      this.activeRunIds.delete(context.detail.run.id);
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

    const artifactCounts = await this.readArtifactCounts(context.detail.run.id);
    if (!this.ensureRunIsActive(context)) {
      return;
    }
    context.detail.run = this.buildTerminalRunRecord(context.detail.run, {
      commandCount: artifactCounts.commandCount,
      notes,
      outcome: "failure",
      patchCount: artifactCounts.patchCount,
      status: "failed",
      verificationPassed: false,
    });

    await this.emitEvent(context, {
      detail: runnerError?.hint ? `${message} Hint: ${runnerError.hint}` : message,
      level: "error",
      message: "Run failed during execution.",
      type: "run_failed",
    });
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

  private getRunPatchesDirectory(runId: string) {
    return join(this.getRunDirectory(runId), "patches");
  }

  private getRunCommandResultsDirectory(runId: string) {
    return join(this.getRunDirectory(runId), "command-results");
  }

  private getRunScreenshotUrl(runId: string, path: string) {
    return `/api/runs/${runId}/artifacts/screenshots/${basename(path)}`;
  }

  private getRunWorkspacePath(runId: string) {
    return join(this.dataRoot, "workspaces", runId);
  }

  private getScenarioWorkspacePath(scenarioId: string) {
    return join(this.dataRoot, "scenario-workspaces", scenarioId);
  }

  private async ensureBaseDirectories() {
    await mkdir(join(this.dataRoot, "runs"), { recursive: true });
    await mkdir(join(this.dataRoot, "workspaces"), { recursive: true });
    await mkdir(join(this.dataRoot, "scenario-workspaces"), { recursive: true });
  }

  private async emitEvent(
    context: InternalRunContext,
    input: {
      detail?: string;
      level: RunEventLevel;
      message: string;
      type: RunEventType;
    },
  ) {
    const event = runEventSchema.parse({
      createdAt: this.now().toISOString(),
      detail: input.detail,
      id: `${context.detail.run.id}:${context.detail.events.length}`,
      level: input.level,
      message: input.message,
      runId: context.detail.run.id,
      sequence: context.detail.events.length,
      type: input.type,
    });

    context.detail.events.push(event);

    if (context.detail.run.summary) {
      context.detail.run.summary.stepCount = context.detail.events.length;
    }

    await appendFile(
      this.getRunEventsPath(context.detail.run.id),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
    await this.persistContext(context);

    for (const subscriber of context.subscribers) {
      subscriber(event);
    }
  }

  private async initializeRunArtifacts(runId: string) {
    const runDir = this.getRunDirectory(runId);

    await mkdir(runDir, { recursive: true });
    await mkdir(this.getRunCommandResultsDirectory(runId), { recursive: true });
    await mkdir(join(runDir, "logs"), { recursive: true });
    await mkdir(this.getRunPatchesDirectory(runId), { recursive: true });
    await mkdir(this.getRunScreenshotsDirectory(runId), { recursive: true });
    await writeFile(this.getRunEventsPath(runId), "", "utf8");
  }

  private async persistContext(context: InternalRunContext) {
    const runId = context.detail.run.id;
    const screenshotCount = context.detail.browser?.screenshots.length ?? 0;

    if (context.detail.run.summary) {
      context.detail.run.summary.screenshotCount = screenshotCount;
      context.detail.run.summary.stepCount = context.detail.events.length;
    }

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

  private async readArtifactCounts(runId: string) {
    const [patches, commandResults] = await Promise.all([
      readdir(this.getRunPatchesDirectory(runId)).catch(() => []),
      readdir(this.getRunCommandResultsDirectory(runId)).catch(() => []),
    ]);

    return {
      commandCount: commandResults.length,
      patchCount: patches.length,
    };
  }

  private async readRunDetail(runId: string): Promise<RunDetail> {
    try {
      const run = runRecordSchema.parse(
        JSON.parse(await readFile(this.getRunRecordPath(runId), "utf8")),
      );
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

      const events = await this.readRunEvents(runId);
      const replayBundle = await this.getReplayBundle(runId);

      return runDetailSchema.parse({
        browser: replayBundle.browser,
        eventStreamUrl: `/api/runs/${runId}/events`,
        events,
        replayUrl: `/api/runs/${runId}/replay`,
        run,
        scenario,
        workspacePath: replayBundle.artifacts.workspacePath,
      });
    } catch (error) {
      throw this.wrapMissingRunError(runId, error);
    }
  }

  private async readRunEvents(runId: string) {
    const raw = await readFile(this.getRunEventsPath(runId), "utf8");

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => runEventSchema.parse(JSON.parse(line)));
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
