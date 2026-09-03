import { type BrowserSession } from "@cua-sample/browser-runtime";
import { type KanbanBoardState } from "@cua-sample/scenario-kit";

export const kanbanColumnOrder = ["backlog", "in_progress", "done"] as const;

const cardTitleToId = {
  "audit replay artifacts": "replay_audit",
  "circulate launch brief": "launch_brief",
  "close nav bug triage": "bug_triage",
  "finalize analytics spec": "analytics_spec",
  "polish stage tooltips": "tooltips",
  "refresh workspace docs": "workspace_docs",
} as const;

const cardIds = new Set(Object.values(cardTitleToId));
type KanbanCardId = (typeof cardTitleToId)[keyof typeof cardTitleToId];
const columnAliases = new Map<string, (typeof kanbanColumnOrder)[number]>([
  ["backlog", "backlog"],
  ["done", "done"],
  ["in progress", "in_progress"],
  ["in_progress", "in_progress"],
  ["in-progress", "in_progress"],
]);

function cloneBoardState(boardState: KanbanBoardState): KanbanBoardState {
  return JSON.parse(JSON.stringify(boardState)) as KanbanBoardState;
}

function normalizeToken(token: string) {
  return token
    .trim()
    .toLowerCase()
    .replace(/["'.]/g, "")
    .replace(/\s+/g, " ");
}

function resolveCardId(token: string) {
  const normalized = normalizeToken(token);

  if (Object.hasOwn(cardTitleToId, normalized)) {
    return cardTitleToId[normalized as keyof typeof cardTitleToId];
  }

  const candidateId = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  if (cardIds.has(candidateId as KanbanCardId)) {
    return candidateId as KanbanCardId;
  }

  return null;
}

function formatBoardState(boardState: KanbanBoardState) {
  return kanbanColumnOrder
    .map((columnId) => `${columnId}: ${boardState[columnId].join(" -> ")}`)
    .join(" | ");
}

function parseBoardLine(line: string, targetState: KanbanBoardState) {
  const match = line.match(/^([a-z_\-\s]+)\s*:\s*(.*)$/i);

  if (!match) {
    return false;
  }

  const rawColumn = match[1]?.trim().toLowerCase() ?? "";
  const rawCards = match[2]?.trim() ?? "";
  const columnId = columnAliases.get(rawColumn);

  if (!columnId) {
    return false;
  }

  const tokens = !rawCards || /^(?:none|empty|\[\])$/i.test(rawCards) ? [] : rawCards.split(/\s*(?:->|,)\s*/g);
  targetState[columnId] = tokens.map(token => {
    const id = resolveCardId(token);
    if (!id) throw new Error(`Kanban prompt references unknown card "${token}".`);
    return id;
  });
  return columnId;
}

export function parseKanbanTargetBoardState(prompt: string): KanbanBoardState {
  const targetState: KanbanBoardState = {
    backlog: [],
    done: [],
    in_progress: [],
  };

  const matchedColumns = new Set<(typeof kanbanColumnOrder)[number]>();

  for (const line of prompt.split("\n")) {
    const columnId = parseBoardLine(line.trim(), targetState);
    if (columnId) matchedColumns.add(columnId);
  }

  if (matchedColumns.size !== kanbanColumnOrder.length) {
    throw new Error(
      [
        "Kanban prompt must define backlog, in_progress, and done lines.",
        "Example:",
        'backlog: Refresh workspace docs',
        'in_progress: Close nav bug triage -> Finalize analytics spec',
        'done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips',
      ].join(" "),
    );
  }

  const flattenedCards = kanbanColumnOrder.flatMap((columnId) => targetState[columnId]);
  const uniqueCards = new Set(flattenedCards);

  if (flattenedCards.length !== cardIds.size || uniqueCards.size !== cardIds.size) {
    throw new Error(
      "Kanban prompt must place each card exactly once across backlog, in_progress, and done.",
    );
  }

  for (const cardId of cardIds) {
    if (!uniqueCards.has(cardId)) {
      throw new Error(`Kanban prompt omitted card "${cardId}".`);
    }
  }

  return targetState;
}

export function buildKanbanRunnerPrompt(prompt: string) {
  return prompt.trim();
}

export function buildKanbanCodeInstructions(currentUrl: string) {
  return [
    "You are operating a persistent Playwright browser session for a gpt-5.6-sol CUA demo harness.",
    "You must use the exec_js tool before you answer.",
    `The kanban app is already open at ${currentUrl}.`,
    "Use only the operator prompt as the source of truth.",
    "Rearrange the live board so every column matches the requested column membership and exact card order.",
    "Reply briefly once the board matches the requested final state.",
  ].join("\n");
}

async function readBoardStateFromPage(session: BrowserSession) {
  return session.page.evaluate(() => {
    const scope = globalThis as unknown as Record<
      string,
      (() => KanbanBoardState) | undefined
    >;
    const accessor = scope.__kanbanReadBoardState;

    if (typeof accessor !== "function") {
      throw new Error("Kanban board accessor is unavailable.");
    }

    return accessor();
  });
}

export async function readKanbanBoardState(session: BrowserSession) {
  return cloneBoardState(await readBoardStateFromPage(session));
}

export async function assertKanbanOutcome(session: BrowserSession, prompt: string) {
  const targetState = parseKanbanTargetBoardState(prompt);

  await session.page.waitForFunction((expectedState) => {
    const scope = globalThis as unknown as {
      __kanbanLabReady?: boolean;
      __kanbanReadBoardState?: () => KanbanBoardState;
    };

    if (scope.__kanbanLabReady !== true || typeof scope.__kanbanReadBoardState !== "function") {
      return false;
    }

    const currentBoardState = scope.__kanbanReadBoardState();
    const columnOrder = ["backlog", "in_progress", "done"] as const;

    return columnOrder.every((columnId) => {
      const currentCards = currentBoardState[columnId];
      const targetCards = expectedState[columnId];

      return (
        Array.isArray(currentCards) &&
        Array.isArray(targetCards) &&
        currentCards.length === targetCards.length &&
        currentCards.every((cardId, index) => targetCards[index] === cardId)
      );
    });
  }, targetState);

  const boardState = await readKanbanBoardState(session);

  if (formatBoardState(boardState) !== formatBoardState(targetState)) {
    throw new Error(
      [
        "Kanban verification failed.",
        `Expected ${formatBoardState(targetState)}.`,
        `Observed ${formatBoardState(boardState)}.`,
      ].join(" "),
    );
  }
}
