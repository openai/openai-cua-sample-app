# Lab tasks

These tasks work in both the [JavaScript](../../javascript-app/README.md) and [Python](../../python-app/README.md) apps. Describe the desired result in ordinary language; no special prompt format is required.

**Run finished** means execution ended normally. Use the model response, screenshot timeline, and **Replay JSON** to inspect what happened and judge whether the task was accomplished.

## Launch Planner — Kanban

Scenario ID: `kanban-reprioritize-sprint`.

Move cards between columns and change their order. For example:

```text
Leave Refresh workspace docs in Backlog. Put Close nav bug triage followed by
Finalize analytics spec in In progress. Put Circulate launch brief, Audit replay
artifacts, and Polish stage tooltips in Done, in that order.
```

Inspect the final board screenshot for the requested column membership and order.

## Sketch Studio — Paint

Scenario ID: `paint-draw-poster`.

```text
Draw a yellow smiley face with black eyes and a curved smile, then save the draft.
```

Inspect the final screenshot and model response to judge the drawing. The saved draft stays in browser storage for the current lab session. See the [paint guide](paint.md) for drawing and saving.

## Northstar Stays — Booking

Scenario ID: `booking-complete-reservation`.

Filter inventory and complete a reservation. For example:

```text
Book the Luma Harbor Hotel in the Marina District from April 18 to April 21,
2026 for Ada Lovelace (ada.lovelace@example.com). Filter for breakfast included
and a workspace desk. Request a late arrival after 9pm, then confirm the booking.
```

Inspect the confirmation screenshot for the hotel, guest, dates, and special request. This is a local simulation; it does not book a real hotel.
