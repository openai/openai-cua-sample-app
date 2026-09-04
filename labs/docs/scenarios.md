# Lab tasks

Task prompts and verification rules for the shared browser labs. See the [JavaScript app guide](../../javascript-app/README.md) for setup and execution.

In the JavaScript app, verification is off by default. When enabled, it reads the final lab state independently of the model's final message. For Kanban and Booking, use the structured prompts below; the runner validates required fields before model execution. Their supplied freeform defaults can be used with verification off.

## Launch Planner — Kanban

Scenario ID: `kanban-reprioritize-sprint`. Lab ID: `kanban`.

The model reads and rearranges a board. Verification checks exact card membership and order against the requested final columns.

```text
Reorganize the board to match this final state exactly.
backlog: Refresh workspace docs
in_progress: Close nav bug triage -> Finalize analytics spec
done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips
```

All three columns must be present, and every known card must appear exactly once. Use `backlog:` or `backlog: empty` for an empty column. Unknown cards are rejected before the model runs when verification is enabled.

## Sketch Studio — Paint

Scenario ID: `paint-draw-poster`. Lab ID: `paint`.

```text
Draw a yellow smiley face with black eyes and a curved smile, then save the draft.
```

Verification checks a consistent, nonblank saved document. Visual review determines whether the drawing matches the requested subject. See the [paint guide](paint.md) for controls, persistence, saved artifacts, and verification rules.

## Northstar Stays — Booking

Scenario ID: `booking-complete-reservation`. Lab ID: `booking`.

The model filters inventory and completes a reservation form. Verification checks the applied filters and local confirmation against the requested hotel, guest, dates, and special request.

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

The dates and confirmation belong to the local lab; the workflow does not book a real hotel.
