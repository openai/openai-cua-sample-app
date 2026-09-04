import { describe, expect, it } from "vitest";

import { parseKanbanTargetBoardState } from "../../../../python-app/packages/runner-core/src/kanban-plan.js";

const allCards = [
  "launch_brief",
  "bug_triage",
  "analytics_spec",
  "workspace_docs",
  "replay_audit",
  "tooltips",
];

describe("kanban target parsing", () => {
  it.each(["", "none", "empty", "[]"])(
    "accepts empty columns written as %j when all cards are done",
    (emptyColumn) => {
      expect(parseKanbanTargetBoardState([
        `backlog: ${emptyColumn}`,
        `in_progress: ${emptyColumn}`,
        `done: ${allCards.join(" -> ")}`,
      ].join("\n"))).toEqual({ backlog: [], in_progress: [], done: allCards });
    },
  );

  it("distinguishes an omitted column from an explicitly empty column", () => {
    expect(() => parseKanbanTargetBoardState([
      "backlog:",
      `done: ${allCards.join(", ")}`,
    ].join("\n"))).toThrow("must define backlog, in_progress, and done lines");
  });

  it("rejects unknown cards instead of silently discarding requested work", () => {
    expect(() => parseKanbanTargetBoardState([
      "backlog: launch_brief",
      "in_progress: bug_triage",
      "done: analytics_spec, workspace_docs, replay_audit, tooltips, unknown task",
    ].join("\n"))).toThrow('unknown card "unknown task"');
  });

  it("still requires every card exactly once", () => {
    expect(() => parseKanbanTargetBoardState([
      "backlog:",
      "in_progress:",
      `done: ${allCards.slice(1).join(", ")}, tooltips`,
    ].join("\n"))).toThrow("must place each card exactly once");
  });
});
