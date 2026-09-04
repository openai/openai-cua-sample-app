import { getLabDefinition } from "./lab-data.js";
export type KanbanBoardState = Record<"backlog" | "done" | "in_progress", string[]>;
export const kanbanDefaultPrompt = getLabDefinition("kanban").defaultPrompt;
