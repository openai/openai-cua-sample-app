# Lab tasks

These tasks work in both the [JavaScript](../../javascript-app/README.md) and [Python](../../python-app/README.md) apps.

Verification is off by default. When enabled, it checks final lab state independently of the model's final message. Use the structured Kanban and Booking prompts below; their free-form defaults work with verification off.

## Launch Planner — Kanban

Scenario ID: `kanban-reprioritize-sprint`.

Rearrange the board. Verification checks exact card membership and order in each column.

```text
Reorganize the board to match this final state exactly.
backlog: Refresh workspace docs
in_progress: Close nav bug triage -> Finalize analytics spec
done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips
```

With verification enabled, all three columns must be present and every known card must appear exactly once. Use `backlog:` for an empty column. Invalid card lists are rejected before the model runs.

## Sketch Studio — Paint

Scenario ID: `paint-draw-poster`.

```text
Draw a yellow smiley face with black eyes and a curved smile, then save the draft.
```

Verification checks a consistent, nonblank saved document. Visual review determines whether the drawing matches the requested subject. See the [paint guide](paint.md) for drawing and saving.

## Northstar Stays — Booking

Scenario ID: `booking-complete-reservation`.

Filter inventory and complete a reservation. Verification checks the applied filters and local confirmation against the request.

```text
Complete the reservation flow using this request.
hotel: Luma Harbor Hotel
neighborhood: Marina District
check_in: 2026-04-18
check_out: 2026-04-21
guest_name: Ada Lovelace
guest_email: ada.lovelace@example.com
requires: breakfast included, workspace desk
special_request: Late arrival after 9pm.
```

This is a local simulation; it does not book a real hotel.
