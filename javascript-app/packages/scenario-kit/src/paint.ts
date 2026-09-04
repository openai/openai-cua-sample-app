import { getLabDefinition } from "./lab-data.js";
export type {
  PaintDocumentSnapshot,
  PaintSaveRecord,
} from "@cua-sample/replay-schema";

export const paintDefaultPrompt = getLabDefinition("paint").defaultPrompt;
