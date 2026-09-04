import { DEFAULT_MODEL_DISPLAY_NAME, type RunDetail } from "@cua-sample/contracts";

import { createDefaultResponsesClient, runResponsesCodeLoop } from "./responses-loop.js";
import {
  createUnsupportedScenarioError,
  runWorkspaceLabBrowserFlow,
  type RunExecutor,
} from "./scenario-runtime.js";
import { getLabInstructions } from "./lab-catalog.js";

type Lab = {
  id: string;
};

const labs: Record<string, Lab> = {
  "booking-complete-reservation": { id: "booking" },
  "kanban-reprioritize-sprint": { id: "kanban" },
  "paint-draw-poster": { id: "paint" },
};

export function createDefaultRunExecutor(detail: RunDetail): RunExecutor {
  const lab = labs[detail.scenario.id];
  if (!lab) throw createUnsupportedScenarioError(detail.scenario.id);

  return {
    async execute(context) {
      const client = createDefaultResponsesClient();
      await context.emitEvent({
        detail: context.detail.run.model,
        level: "ok",
        message: `Using the live Responses API code loop for the ${lab.id} lab.`,
        type: "run_progress",
      });
      await runWorkspaceLabBrowserFlow(context, {
        loadedScreenshotLabel: `${lab.id}-loaded`,
        navigationMessage: `Browser navigated to the ${lab.id} lab.`,
        runner: async ({ labUrl, session }) => {
          const instructions = [
            `You are operating a persistent Playwright browser session for a ${DEFAULT_MODEL_DISPLAY_NAME} CUA demo harness.`,
            "You must use the exec_js tool before you answer.",
            ...(lab.id === "paint" ? ["Observe the interface with display((await page.screenshot()).toString('base64')), then use Playwright locators, page.mouse, and page.keyboard to operate the visible controls. Mouse coordinates refer to the page screenshot."] : []),
            `The lab is already open at ${labUrl}.`,
            ...getLabInstructions(lab.id),
          ].join("\n");
          const result = await runResponsesCodeLoop({
            context,
            instructions,
            maxResponseTurns: context.detail.run.maxResponseTurns,
            prompt: context.detail.run.prompt.trim(),
            session,
          }, client);
          return {
            notes: result.notes,
          };
        },
        sessionLabel: `run-scoped ${lab.id} lab`,
        finalScreenshotLabel: `${lab.id}-final`,
      });
    },
  };
}
