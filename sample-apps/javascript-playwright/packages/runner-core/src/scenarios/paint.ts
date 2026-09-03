import {
  buildPaintCodeInstructions,
  buildPaintRunnerPrompt,
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
      loadedScreenshotLabel: "paint-loaded",
      navigationMessage: "Browser navigated to the paint lab.",
      runner: async ({ labUrl, session }) => {
        const result = await runResponsesCodeLoop(
          {
            context,
            instructions: buildPaintCodeInstructions(labUrl),
            maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
            prompt: buildPaintRunnerPrompt(context.detail.run.prompt),
            session,
          },
          client,
        );

        return {
          notes: result.notes,
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
