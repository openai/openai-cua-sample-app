import { type RunDetail } from "@cua-sample/replay-schema";

import { createUnsupportedScenarioError, type RunExecutor } from "./scenario-runtime.js";
import { createBookingExecutor } from "./scenarios/booking.js";
import { createKanbanExecutor } from "./scenarios/kanban.js";
import { createPaintExecutor } from "./scenarios/paint.js";

export function createDefaultRunExecutor(detail: RunDetail): RunExecutor {
  switch (detail.scenario.id) {
    case "kanban-reprioritize-sprint":
      return createKanbanExecutor();
    case "paint-draw-poster":
      return createPaintExecutor();
    case "booking-complete-reservation":
      return createBookingExecutor();
    default:
      throw createUnsupportedScenarioError(detail.scenario.id);
  }
}
