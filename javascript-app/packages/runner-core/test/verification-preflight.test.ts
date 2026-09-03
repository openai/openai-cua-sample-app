import { afterEach, describe, expect, it, vi } from "vitest";
import { parseKanbanTargetBoardState } from "../src/kanban-plan.js";
import { createBookingExecutor } from "../src/scenarios/booking.js";
import { createKanbanExecutor } from "../src/scenarios/kanban.js";

const allCards = "Refresh workspace docs -> Close nav bug triage -> Finalize analytics spec -> Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips";
const allDone = `backlog:\nin_progress:\ndone: ${allCards}`;

afterEach(() => vi.unstubAllEnvs());

describe("verification preflight", () => {
  it("accepts explicitly empty columns", () => {
    expect(parseKanbanTargetBoardState(allDone)).toEqual({
      backlog: [], in_progress: [], done: ["workspace_docs", "bug_triage", "analytics_spec", "launch_brief", "replay_audit", "tooltips"],
    });
    expect(parseKanbanTargetBoardState(allDone.replace("backlog:", "backlog: empty").replace("in_progress:", "in_progress: []"))).toEqual(parseKanbanTargetBoardState(allDone));
  });

  it("rejects unknown cards rather than dropping them", () => {
    expect(() => parseKanbanTargetBoardState(`${allDone} -> imaginary card`)).toThrow('unknown card "imaginary card"');
  });

  it.each([createBookingExecutor, createKanbanExecutor])("validates the prompt before constructing an API client", async factory => {
    vi.stubEnv("CUA_RESPONSES_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "");
    // Missing credentials would produce missing_api_key if API setup ran first.
    await expect(factory().execute({ detail: { run: { verificationEnabled: true, prompt: "Do something." } } } as never)).rejects.toMatchObject({ code: "invalid_verification_prompt" });
  });
});
