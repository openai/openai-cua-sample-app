import {
  assertKanbanOutcome,
  buildKanbanCodeInstructions,
  buildKanbanRunnerPrompt,
  kanbanColumnOrder,
  parseKanbanTargetBoardState,
  readKanbanBoardState,
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
} from "../scenario-runtime.js";

function formatBoardState(
  input: Record<(typeof kanbanColumnOrder)[number], string[]>,
) {
  return kanbanColumnOrder
    .map((columnId) => `${columnId}=${input[columnId].join(" > ")}`)
    .join(" · ");
}

const liveOnlyMessage =
  "Kanban lab requires the live Responses API. Deterministic fallback is disabled to keep the operator prompt as the only source of truth.";

class KanbanCodeExecutor implements RunExecutor {
  async execute(context: RunExecutionContext) {
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
      assertOutcome: (session) => assertKanbanOutcome(session, context.detail.run.prompt),
      buildVerificationDetail: async (session) => {
        const targetBoardState = parseKanbanTargetBoardState(context.detail.run.prompt);
        const observedBoardState = await readKanbanBoardState(session);

        return `target=${formatBoardState(targetBoardState)} · observed=${formatBoardState(observedBoardState)}`;
      },
      loadedScreenshotLabel: "kanban-loaded",
      navigationMessage: "Browser navigated to the kanban lab.",
      runner: async ({ session }) => {
        const result = await runResponsesCodeLoop(
          {
            context,
            instructions: buildKanbanCodeInstructions(session.page.url()),
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
