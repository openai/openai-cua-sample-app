# Scenarios

The console provides three local browser labs. Each uses the Responses API and a persistent Playwright JavaScript session through `exec_js`.

Verification is off by default. When enabled, it reads the final lab state independently of the model's final message. For Kanban and Booking, use the structured prompts below; the runner validates required fields before model execution. Their supplied freeform defaults can be used with verification off.

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

Sketch Studio is a 1024 × 768 raster editor with drawing tools, shapes, colors, text, rectangular selections, up to eight layers, undo/redo, and zoom/pan. The model operates its visible controls.

```text
Draw a yellow smiley face with black eyes and a curved smile, then save the draft.
```

**Save draft** stores a version-2 save record in IndexedDB. Reload recovery applies within the same lab origin and browser context; new runs start fresh. **Export PNG** downloads the current composite and does not update the saved draft.

After normal model completion, the runner retains the last saved draft as `artwork/draft.sketch.json` and `artwork/draft.png` in the run workspace. Capture occurs before optional verification and also runs when verification is off. A missing draft produces no paint artifacts. Invalid image data or filesystem errors fail the run; cancellation may happen before capture.

Paint verification checks that:

- the current and saved document dimensions, name, layer order, properties, and pixel hashes match;
- independently decoded saved layer PNGs composite to the saved image;
- the saved image contains visible pixels different from the white background.

Unsaved changes, a missing draft, or a blank visible result fail verification. These checks establish save consistency and a nonblank image. Visual review is still needed to judge the requested subject.

See the [paint lab guide](../../labs/paint-lab-template/README.md) for controls and persistence details.

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
