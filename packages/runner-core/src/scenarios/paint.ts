import {
  assertPaintOutcome,
  buildPaintCodeInstructions,
  buildPaintRunnerPrompt,
  readPaintSaveRecord,
  retainPaintArtifacts,
} from "../paint-plan.js";
import {
  createDefaultResponsesClient,
  runResponsesCodeLoop,
} from "../responses-loop.js";
import {
  failLiveResponsesUnavailable,
  type RunExecutionContext,
  type RunExecutor,
  runWorkspaceLabBrowserFlow,
} from "../scenario-runtime.js";

const liveOnlyMessage =
  "Paint lab requires the live Responses API. Deterministic fallback is disabled to avoid hardcoded artwork.";

class PaintCodeExecutor implements RunExecutor {
  async execute(context: RunExecutionContext) {
    const client = createDefaultResponsesClient();

    if (!client) {
      await failLiveResponsesUnavailable(context, liveOnlyMessage);
      return;
    }

    await context.emitEvent({
      detail: context.detail.run.model,
      level: "ok",
      message: "Using the live Responses API code loop for the paint lab.",
      type: "run_progress",
    });

    await runWorkspaceLabBrowserFlow(context, {
      assertOutcome: assertPaintOutcome,
      buildVerificationDetail: async (session) => {
        const saveRecord = await readPaintSaveRecord(session);

        return saveRecord
          ? `pixels=${saveRecord.document.paintedPixelCount} · layers=${saveRecord.document.layers.length}`
          : "saved=none";
      },
      loadedScreenshotLabel: "paint-loaded",
      navigationMessage: "Browser navigated to the paint lab.",
      runner: async ({ session }) => {
        const result = await runResponsesCodeLoop(
          {
            context,
            instructions: buildPaintCodeInstructions(session.page.url()),
            maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
            prompt: buildPaintRunnerPrompt(context.detail.run.prompt),
            session,
          },
          client,
        );

        const artifacts = await retainPaintArtifacts(
          session,
          context.detail.workspacePath,
        );
        if (artifacts) {
          await context.emitEvent({
            type: "run_progress",
            level: "ok",
            message: "Saved paint artifacts retained in the run workspace.",
            detail: `PNG: ${artifacts.imagePath} · Project: ${artifacts.projectPath}`,
          });
        }
        return {
          notes: [
            ...result.notes,
            ...(artifacts
              ? [
                  `Saved artwork: ${artifacts.imagePath}`,
                  `Layered project: ${artifacts.projectPath}`,
                ]
              : ["No draft was saved; no paint artifacts were retained."]),
          ],
          verificationMessage:
            "Paint verification passed after the full Responses code loop.",
        };
      },
      sessionLabel: "run-scoped paint lab",
      verifiedScreenshotLabel: "paint-verified",
    });
  }
}

export function createPaintExecutor(): RunExecutor {
  return new PaintCodeExecutor();
}
