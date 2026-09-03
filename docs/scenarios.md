# Scenarios

The OSS release branch keeps three public scenarios. All of them are browser labs with local verification.

## Kanban

- Scenario id: `kanban-reprioritize-sprint`
- Lab id: `kanban`
- Category: `productivity`

What it exercises:

- reading a structured operator prompt
- rearranging drag-and-drop state in the browser
- verifying exact column membership and card order

How verification works:

- the verifier parses the target board state from the operator prompt
- the live board state is read from the lab
- every card must appear exactly once in the requested column and order

## Paint

- Scenario id: `paint-draw-poster`
- Lab id: `paint`
- Category: `creativity`

Sketch Studio is a 1024 × 768 raster editor. It exercises continuous drawing, shapes, colors, text, rectangular selections, layer ordering and opacity, undo/redo, and explicit saving. The model operates the visible controls through the persistent Playwright REPL.

How verification works:

- versioned read-only accessors provide the current committed document and the separately saved draft
- dimensions, document name, layer order and properties, and hashes of actual pixels must match
- saved layer PNGs are independently decoded, checked, and composited; the result must match the saved composite PNG
- the saved composite must contain pixels different from the white background
- unsaved changes, a missing draft, or a blank visible result fail verification

These checks establish save consistency and a nonblank result. Visual review is still required to judge whether the artwork depicts the requested subject.

Save draft stores an immutable version-2 save record in IndexedDB for reload recovery within the same lab origin and browser context. New runs start fresh. Export PNG downloads the current composite separately and does not update the saved draft.

After normal model completion, the runner retains the last saved draft in the run workspace as `artwork/draft.sketch.json` and `artwork/draft.png`, before optional verification and browser teardown. Capture also runs with verification disabled. If nothing was saved, no paint artifacts are created. Invalid image data or filesystem write errors fail the run explicitly. Cancellation or abrupt termination can end the run before capture.

Example prompt, also exercised in both headless and headful live smoke tests:

```text
Draw a yellow smiley face with black eyes and a curved smile, then save the draft.
```

## Booking

- Scenario id: `booking-complete-reservation`
- Lab id: `booking`
- Category: `commerce`

What it exercises:

- filter selection
- multi-step browsing
- form completion
- booking confirmation

How verification works:

- the operator prompt is parsed into a booking request
- the verifier checks the applied filters in the UI
- the local confirmation record must match the requested hotel, guest, dates, and special request

## Browser Execution And Verification

All scenarios use a persistent Playwright JavaScript REPL through `exec_js`. Verification reads the final lab state, independently of the agent transcript.
