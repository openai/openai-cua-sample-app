import { beforeEach, describe, expect, it, vi } from "vitest";

import { bookingDefaultPrompt, kanbanDefaultPrompt } from "@cua-sample/scenario-kit";

import { type RunExecutionContext } from "../../../../python-app/packages/runner-core/src/scenario-runtime.js";
import { createBookingExecutor } from "../../../../python-app/packages/runner-core/src/scenarios/booking.js";
import { createKanbanExecutor } from "../../../../python-app/packages/runner-core/src/scenarios/kanban.js";

const runtime = vi.hoisted(() => ({
  launchBrowserSession: vi.fn(),
  launchPythonRuntime: vi.fn(),
}));
const responses = vi.hoisted(() => ({
  createDefaultResponsesClient: vi.fn(),
  runResponsesCodeLoop: vi.fn(),
}));
const lab = vi.hoisted(() => ({ startWorkspaceLabServer: vi.fn() }));

vi.mock("@cua-sample/browser-runtime", () => runtime);
vi.mock("../../../../python-app/packages/runner-core/src/responses-loop.js", () => responses);
vi.mock("../../../../python-app/packages/runner-core/src/workspace-lab-server.js", () => lab);

beforeEach(() => {
  vi.resetAllMocks();
  responses.createDefaultResponsesClient.mockReturnValue(null);
});

function contextFor(prompt: string, verificationEnabled: boolean) {
  return {
    detail: { run: { prompt, verificationEnabled } },
    emitEvent: vi.fn(async () => {}),
  } as unknown as RunExecutionContext;
}

describe.each([
  {
    scenario: "kanban",
    createExecutor: createKanbanExecutor,
    defaultPrompt: kanbanDefaultPrompt,
    validPrompt: [
      "backlog:",
      "in_progress:",
      "done: launch_brief, bug_triage, analytics_spec, workspace_docs, replay_audit, tooltips",
    ].join("\n"),
  },
  {
    scenario: "booking",
    createExecutor: createBookingExecutor,
    defaultPrompt: bookingDefaultPrompt,
    validPrompt: [
      "hotel: Luma Harbor Hotel",
      "check_in: 2026-04-18",
      "check_out: 2026-04-21",
      "guest_name: Ada Lovelace",
      "guest_email: ada.lovelace@example.com",
      "special_request: Late arrival after 9pm.",
    ].join("\n"),
  },
])("$scenario verification preflight", ({ createExecutor, defaultPrompt, validPrompt }) => {
  describe("Code execution", () => {
    it("rejects an unstructured prompt before creating a client or launching the lab", async () => {
      await expect(createExecutor().execute(contextFor(defaultPrompt, true)))
        .rejects.toMatchObject({
          code: "invalid_verification_prompt",
          statusCode: 400,
          hint: expect.stringContaining("docs/scenarios.md"),
        });
      expect(responses.createDefaultResponsesClient).not.toHaveBeenCalled();
      expect(responses.runResponsesCodeLoop).not.toHaveBeenCalled();
      expect(lab.startWorkspaceLabServer).not.toHaveBeenCalled();
      expect(runtime.launchBrowserSession).not.toHaveBeenCalled();
      expect(runtime.launchPythonRuntime).not.toHaveBeenCalled();
    });

    it("accepts a structured prompt and proceeds to the API availability check", async () => {
      await expect(createExecutor().execute(contextFor(validPrompt, true)))
        .rejects.toMatchObject({ code: "live_mode_unavailable" });
      expect(responses.createDefaultResponsesClient).toHaveBeenCalledOnce();
    });

    it("preserves free-form prompts when verification is disabled", async () => {
      await expect(createExecutor().execute(contextFor(defaultPrompt, false)))
        .rejects.toMatchObject({ code: "live_mode_unavailable" });
      expect(responses.createDefaultResponsesClient).toHaveBeenCalledOnce();
    });
  });
});
