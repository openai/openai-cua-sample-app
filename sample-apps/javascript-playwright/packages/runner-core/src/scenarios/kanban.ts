import {
  buildKanbanCodeInstructions,
  buildKanbanRunnerPrompt,
  parseKanbanTargetBoardState,
} from "../kanban-plan.js";
import {
  createDefaultResponsesClient,
  runResponsesCodeLoop,
} from "../responses-loop.js";
import {
  failLiveResponsesUnavailable,
  type RunExecutionContext,
  type RunExecutor,
  runWorkspaceLabBrowserFlow,
  validateVerificationPrompt,
} from "../scenario-runtime.js";

const liveOnlyMessage =
  "Kanban lab requires the live Responses API. Deterministic fallback is disabled to keep the operator prompt as the only source of truth.";

class KanbanCodeExecutor implements RunExecutor {
  async execute(context: RunExecutionContext) {
    validateVerificationPrompt(context, parseKanbanTargetBoardState, "Use the structured prompt in docs/scenarios.md, or turn verification off for a free-form task.");
    const client = createDefaultResponsesClient();

    if (!client) {
      await failLiveResponsesUnavailable(context, liveOnlyMessage);
      return;
    }

    await context.emitEvent({
      detail: context.detail.run.model,
      level: "ok",
      message: "Using the live Responses API code loop for the kanban lab.",
      type: "run_progress",
    });

    await runWorkspaceLabBrowserFlow(context, {
      loadedScreenshotLabel: "kanban-loaded",
      navigationMessage: "Browser navigated to the kanban lab.",
      runner: async ({ labUrl, session }) => {
        const result = await runResponsesCodeLoop(
          {
            context,
            instructions: buildKanbanCodeInstructions(labUrl),
            maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
            prompt: buildKanbanRunnerPrompt(context.detail.run.prompt),
            session,
          },
          client,
        );

        return {
          notes: result.notes,
          verificationMessage:
            "Kanban verification passed after the full Responses code loop.",
        };
      },
      sessionLabel: "run-scoped kanban lab",
      verifiedScreenshotLabel: "kanban-verified",
    });
  }
}

export function createKanbanExecutor(): RunExecutor {
  return new KanbanCodeExecutor();
}
