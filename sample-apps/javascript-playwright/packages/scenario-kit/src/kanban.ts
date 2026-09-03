export type KanbanBoardState = Record<"backlog" | "done" | "in_progress", string[]>;
export const kanbanDefaultPrompt = "Reorganize the board to make everything as done.";
