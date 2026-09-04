# Sketch Studio

A self-contained raster editor used by the `paint-draw-poster` task. See the [task guide](scenarios.md#sketch-studio--paint) for an example prompt and the [JavaScript app guide](../../javascript-app/README.md) to run it.

## Drawing and editing

The document is 1024 × 768 pixels, with up to eight transparent drawing layers over a fixed white background. The editor fits its window; panels and history scroll internally. Toggle panels opens the color/layer drawer in narrow windows.

| Control | Behavior |
| --- | --- |
| Brush / Pencil | Continuous strokes; adjustable size and brush opacity. |
| Eraser | Removes active-layer pixels, revealing layers below. |
| Fill | Contiguous active-layer fill with adjustable tolerance. |
| Picker | Samples the visible composite. |
| Line / Rectangle / Ellipse | Drag a preview and release to commit; rectangles and ellipses support outline, fill, or both. Shift constrains proportions or line angles. |
| Text | Click, type, then Enter or Apply text. Shift+Enter inserts a newline; Escape cancels. Text becomes raster pixels. |
| Select | Drag a rectangular marquee, then drag inside to move pixels. Duplicate, delete, or deselect from tool options or Edit. |
| Layers | Add, rename, duplicate, hide, reorder, delete, or change opacity. Up/down buttons supplement drag reorder. Deleting the last layer clears it. |
| History | Undo/redo drawing and document edits. Up to 50 actions and 64 MiB; new edits after undo replace the redo branch. History is not persisted. |
| Zoom / Hand | Fit, 100%, 25–400% zoom, and pan. Fit can use a smaller scale on narrow screens. Space-drag temporarily pans. |

Rename the document in the strip above the canvas. Colors include 16 named swatches, a six-digit hex field, and an in-app hue/saturation/lightness picker.

Tool keys: **B** brush, **P** pencil, **E** eraser, **G** fill, **I** picker, **L** line, **R** rectangle, **O** ellipse, **T** text, **M** selection, **H** hand. Brackets change size. Use ⌘/Ctrl+Z to undo, Shift+⌘/Ctrl+Z to redo, ⌘/Ctrl+S to save, and Escape to cancel/deselect. Shortcuts leave text entry alone. File/Edit/View menus also support arrow keys and Escape.

## Saving

**Save draft** records a version-2 document snapshot in IndexedDB: layer order/properties and PNGs, pixel hashes, and a composite PNG. It restores after a reload in the same lab origin and browser context. A failed save leaves the document unsaved. Tool choice and navigation do not dirty the document; undoing to the saved history position clears the dirty indicator. New document asks before discarding unsaved edits.

**Export PNG** downloads the current white-backed composite at 1024 × 768, excluding panels, cursors, and selection outlines. It does not save the layered draft.

After normal model completion, the JavaScript runner retains the last saved draft as `artwork/draft.sketch.json` and `artwork/draft.png` in the run workspace. Capture happens before optional verification and also runs when verification is off. The activity log records the paths; successful run summaries include them too.

No saved draft means no retained paint files. Invalid image data or file-write errors fail the run. Cancellation or abrupt termination can prevent capture. The JSON retains layer data for inspection; this release has no project-file import UI. A new run starts a fresh document.

## Verification and implementation

Read-only `__paintReadDocumentSnapshot()` and `__paintReadSaveRecord()` accessors expose current and saved state separately; `__paintLabReady` marks initialization complete. There are no programmatic drawing or save globals. Model interaction uses visible controls.

The JavaScript sample app's verifier checks that:

- current and saved document dimensions, name, layer order, properties, and pixel hashes match;
- independently decoded saved layer PNGs composite to the saved image;
- the saved image contains visible pixels different from the white background.

Unsaved changes, a missing draft, or a blank visible result fail verification. These checks establish save consistency and a nonblank image. Visual review is still needed to judge the requested subject.

Modules in [`editor/`](../paint-lab-template/editor/) separate document/layers, history, coordinate geometry, pixel operations, rendering, tools, and persistence. No build step, external image service, or editor framework is required.

## Checks

From the repository's `javascript-app/` directory, run `pnpm playwright:install` once, then `pnpm test:paint:browser` to exercise editor interactions in headless Chromium. The regular `pnpm test` suite also uses Chromium for worker and cancellation tests. Neither suite calls the OpenAI API.

The opt-in `pnpm test:live` suite also exercises paint in headless and visible Chromium and sends real API requests. See the [JavaScript contributing guide](../../javascript-app/docs/contributing.md#checks) for setup and checks.
