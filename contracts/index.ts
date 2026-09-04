import { z } from "zod";

const labIdSchema = z.enum(["kanban", "paint", "booking"]);

const categorySchema = z.enum(["productivity", "creativity", "commerce"]);

const browserModeSchema = z.enum(["headless", "headful"]);
export type BrowserMode = z.infer<typeof browserModeSchema>;

const responseTurnBudgetSchema = z.number().int().positive().max(50);
export type ResponseTurnBudget = z.infer<typeof responseTurnBudgetSchema>;

export const scenarioManifestSchema = z.object({
  id: z.string().min(1),
  labId: labIdSchema,
  category: categorySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  defaultPrompt: z.string().min(1),
  workspaceTemplatePath: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
});
export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;

const runSummarySchema = z.object({
  stepCount: z.number().int().nonnegative(),
  screenshotCount: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

const runStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
]);

const runEventLevelSchema = z.enum(["ok", "pending", "warn", "error"]);
export type RunEventLevel = z.infer<typeof runEventLevelSchema>;

const runEventTypeSchema = z.enum([
  "run_started",
  "workspace_prepared",
  "lab_started",
  "browser_session_started",
  "browser_navigated",
  "function_call_requested",
  "function_call_completed",
  "screenshot_captured",
  "run_progress",
  "run_completed",
  "run_failed",
  "run_cancelled",
]);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const runEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  type: runEventTypeSchema,
  level: runEventLevelSchema,
  message: z.string().min(1),
  detail: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type RunEvent = z.infer<typeof runEventSchema>;

export const runRecordSchema = z.object({
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  labId: labIdSchema,
  browserMode: browserModeSchema,
  model: z.string().min(1),
  maxResponseTurns: responseTurnBudgetSchema,
  prompt: z.string().min(1),
  status: runStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  summary: runSummarySchema.optional(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

const browserViewportSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
});
export type BrowserViewport = z.infer<typeof browserViewportSchema>;

export const browserScreenshotArtifactSchema = z.object({
  source: z.enum(["browser_preview", "code_tool"]).optional(),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  capturedAt: z.string().datetime(),
  id: z.string().min(1),
  label: z.string().min(1),
  mimeType: z.literal("image/png"),
  pageTitle: z.string().min(1).optional(),
  pageUrl: z.string().min(1),
  path: z.string().min(1),
  url: z.string().min(1),
});
export type BrowserScreenshotArtifact = z.infer<
  typeof browserScreenshotArtifactSchema
>;

export const browserStateSchema = z.object({
  currentUrl: z.string().min(1),
  mode: browserModeSchema,
  pageTitle: z.string().min(1).optional(),
  screenshots: z.array(browserScreenshotArtifactSchema),
  targetLabel: z.string().min(1),
  viewport: browserViewportSchema,
});
export type BrowserState = z.infer<typeof browserStateSchema>;

export const startRunRequestSchema = z
  .object({
    scenarioId: z.string().min(1),
    browserMode: browserModeSchema.optional(),
    maxResponseTurns: responseTurnBudgetSchema.optional(),
    prompt: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

export const runDetailSchema = z.object({
  run: runRecordSchema,
  scenario: scenarioManifestSchema,
  workspacePath: z.string().min(1),
  eventStreamUrl: z.string().min(1),
  replayUrl: z.string().min(1),
  browser: browserStateSchema.optional(),
  events: z.array(runEventSchema),
});
export type RunDetail = z.infer<typeof runDetailSchema>;

export const startRunResponseSchema = z.object({
  runId: z.string().min(1),
  status: z.literal("running"),
  eventStreamUrl: z.string().min(1),
  replayUrl: z.string().min(1),
  detail: runDetailSchema,
});
export type StartRunResponse = z.infer<typeof startRunResponseSchema>;

export const scenarioResetResponseSchema = z.object({
  scenarioId: z.string().min(1),
  resetAt: z.string().datetime(),
  cancelledRunId: z.string().min(1).optional(),
});
export type ScenarioResetResponse = z.infer<typeof scenarioResetResponseSchema>;

export const scenariosResponseSchema = z.array(scenarioManifestSchema);

export const runnerErrorResponseSchema = z.object({
  code: z.string().min(1),
  error: z.string().min(1),
  hint: z.string().min(1).optional(),
});
export type RunnerErrorResponse = z.infer<typeof runnerErrorResponseSchema>;

const backendIdSchema = z.enum(["javascript", "python"]);

const backendDefaultsSchema = z.object({
  browserMode: browserModeSchema,
  model: z.string().min(1),
  maxResponseTurns: responseTurnBudgetSchema,
});
const backendCapabilitiesBaseSchema = z.object({
  backendId: backendIdSchema,
  instanceId: z.string().min(1),
  codeTool: z.enum(["exec_js", "exec_py"]),
  browserModes: z.array(browserModeSchema).min(1),
  defaults: backendDefaultsSchema,
});
// Each backend exposes its own code tool and supported browser modes.
export type BackendCapabilities = z.infer<typeof backendCapabilitiesBaseSchema>;
export const backendCapabilitiesSchema: z.ZodType<BackendCapabilities> = z.discriminatedUnion("backendId", [
  backendCapabilitiesBaseSchema.extend({
    backendId: z.literal("javascript"),
    codeTool: z.literal("exec_js"),
    browserModes: z.tuple([z.literal("headless"), z.literal("headful")]),
  }),
  backendCapabilitiesBaseSchema.extend({
    backendId: z.literal("python"),
    codeTool: z.literal("exec_py"),
    browserModes: z.tuple([z.literal("headful")]),
    defaults: backendDefaultsSchema.extend({ browserMode: z.literal("headful") }),
  }),
]);

export const replayBundleSchema = z.object({
  version: z.literal(3),
  run: runRecordSchema,
  scenario: scenarioManifestSchema,
  events: z.array(runEventSchema),
  browser: browserStateSchema.optional(),
  artifacts: z.object({
    eventsPath: z.string().min(1),
    replayPath: z.string().min(1),
    runPath: z.string().min(1),
    screenshotsDirectory: z.string().min(1),
    workspacePath: z.string().min(1),
  }),
});
export type ReplayBundle = z.infer<typeof replayBundleSchema>;
