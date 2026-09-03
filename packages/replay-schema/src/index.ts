import { z } from "zod";

export const labIdSchema = z.enum(["kanban", "paint", "booking"]);
export type LabId = z.infer<typeof labIdSchema>;

export const categorySchema = z.enum(["productivity", "creativity", "commerce"]);
export type ScenarioCategory = z.infer<typeof categorySchema>;

export const browserModeSchema = z.enum(["headless", "headful"]);
export type BrowserMode = z.infer<typeof browserModeSchema>;

export const responseTurnBudgetSchema = z.number().int().positive().max(50);
export type ResponseTurnBudget = z.infer<typeof responseTurnBudgetSchema>;

export const verificationKindSchema = z.enum([
  "board_state",
  "canvas_state",
  "booking_record",
]);
export type VerificationKind = z.infer<typeof verificationKindSchema>;

export const verificationSpecSchema = z.object({
  id: z.string().min(1),
  kind: verificationKindSchema,
  description: z.string().min(1),
});
export type VerificationSpec = z.infer<typeof verificationSpecSchema>;

export const startTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("remote_url"),
    label: z.string().min(1).optional(),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("workspace_file"),
    label: z.string().min(1).optional(),
    path: z.string().min(1),
  }),
]);
export type StartTarget = z.infer<typeof startTargetSchema>;

export const scenarioManifestSchema = z.object({
  id: z.string().min(1),
  labId: labIdSchema,
  category: categorySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  defaultPrompt: z.string().min(1),
  workspaceTemplatePath: z.string().min(1),
  startTarget: startTargetSchema,
  supportsCodeEdits: z.boolean(),
  verification: z.array(verificationSpecSchema).min(1),
  tags: z.array(z.string().min(1)).min(1),
});
export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;

export const runOutcomeSchema = z.enum(["success", "failure", "partial"]);
export type RunOutcome = z.infer<typeof runOutcomeSchema>;

export const runSummarySchema = z.object({
  outcome: runOutcomeSchema,
  verificationPassed: z.boolean(),
  stepCount: z.number().int().nonnegative(),
  screenshotCount: z.number().int().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  patchCount: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runEventLevelSchema = z.enum(["ok", "pending", "warn", "error"]);
export type RunEventLevel = z.infer<typeof runEventLevelSchema>;

export const runEventTypeSchema = z.enum([
  "run_started",
  "workspace_prepared",
  "lab_started",
  "browser_session_started",
  "browser_navigated",
  "function_call_requested",
  "function_call_completed",
  "screenshot_captured",
  "run_progress",
  "verification_completed",
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
  verificationEnabled: z.boolean().optional(),
  model: z.string().min(1),
  maxResponseTurns: responseTurnBudgetSchema.optional(),
  prompt: z.string().min(1),
  status: runStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  summary: runSummarySchema.optional(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const browserViewportSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
});
export type BrowserViewport = z.infer<typeof browserViewportSchema>;

export const browserScreenshotArtifactSchema = z.object({
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
    verificationEnabled: z.boolean().optional(),
    maxResponseTurns: responseTurnBudgetSchema.optional(),
    prompt: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

export const startRunResponseSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["queued", "running"]),
  eventStreamUrl: z.string().min(1),
  replayUrl: z.string().min(1),
});
export type StartRunResponse = z.infer<typeof startRunResponseSchema>;

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

export const scenarioWorkspaceStateSchema = z.object({
  scenarioId: z.string().min(1),
  workspacePath: z.string().min(1),
  resetAt: z.string().datetime(),
  cancelledRunId: z.string().min(1).optional(),
});
export type ScenarioWorkspaceState = z.infer<typeof scenarioWorkspaceStateSchema>;

export const scenariosResponseSchema = z.array(scenarioManifestSchema);

export const runnerErrorResponseSchema = z.object({
  code: z.string().min(1),
  error: z.string().min(1),
  hint: z.string().min(1).optional(),
});
export type RunnerErrorResponse = z.infer<typeof runnerErrorResponseSchema>;
