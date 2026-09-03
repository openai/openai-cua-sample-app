import {
  buildBookingCodeInstructions,
  buildBookingRunnerPrompt,
  parseBookingRequest,
} from "../booking-plan.js";
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
  "Booking lab requires the live Responses API. Deterministic fallback is disabled to keep the operator prompt as the only source of truth.";

class BookingCodeExecutor implements RunExecutor {
  async execute(context: RunExecutionContext) {
    validateVerificationPrompt(context, parseBookingRequest, "Use the structured prompt in docs/scenarios.md, or turn verification off for a free-form task.");
    const client = createDefaultResponsesClient();

    if (!client) {
      await failLiveResponsesUnavailable(context, liveOnlyMessage);
      return;
    }

    await context.emitEvent({
      detail: context.detail.run.model,
      level: "ok",
      message: "Using the live Responses API code loop for the booking lab.",
      type: "run_progress",
    });

    await runWorkspaceLabBrowserFlow(context, {
      loadedScreenshotLabel: "booking-loaded",
      navigationMessage: "Browser navigated to the booking lab.",
      runner: async ({ labUrl, session }) => {
        const result = await runResponsesCodeLoop(
          {
            context,
            instructions: buildBookingCodeInstructions(labUrl),
            maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
            prompt: buildBookingRunnerPrompt(context.detail.run.prompt),
            session,
          },
          client,
        );

        return {
          notes: result.notes,
          verificationMessage:
            "Booking verification passed after the full Responses code loop.",
        };
      },
      sessionLabel: "run-scoped booking lab",
      verifiedScreenshotLabel: "booking-verified",
    });
  }
}

export function createBookingExecutor(): RunExecutor {
  return new BookingCodeExecutor();
}
