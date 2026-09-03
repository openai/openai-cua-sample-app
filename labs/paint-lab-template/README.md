# Sketch Studio

A static raster paint application copied into each `paint-draw-poster` run workspace. The browser is operated through the app's persistent Playwright JavaScript runtime using `exec_js`.

## Drawing and editing

The document is 1024 × 768 pixels, with up to eight transparent drawing layers over a fixed white background. The editor fits its window; panels and history scroll internally. Toggle panels opens the color/layer drawer in narrow windows.

| Control | Behavior |
| --- | --- |
| Brush / Pencil | Continuous strokes; adjustable size and brush opacity. |
| Eraser | Removes active-layer pixels, revealing layers below. |
| Fill | Contiguous active-layer fill with adjustable tolerance. |
| Picker | Samples the visible composite. |
| Line / Rectangle / Ellipse | Drag a preview and release to commit; shapes support outline, fill, or both. Shift constrains proportions or line angles. |
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

After a normal model run, the runner retains the last saved snapshot as `artwork/draft.sketch.json` and `artwork/draft.png` in the run workspace, even if verification is off. Cancellation or abrupt termination can prevent capture. The JSON retains layer data for inspection; this release has no project-file import UI. A new run starts a fresh document.

## Verification and implementation

Read-only `__paintReadDocumentSnapshot()` and `__paintReadSaveRecord()` accessors expose current and saved state separately; `__paintLabReady` marks initialization complete. There are no programmatic drawing or save globals. Model interaction uses visible controls.

The runner checks that current and saved metadata/pixel hashes match, independently decodes and recomposites PNGs, and rejects blank visible artwork. It verifies save consistency rather than the requested subject. See [scenario details](../../docs/scenarios.md).

Modules in `editor/` separate document/layers, history, coordinate geometry, pixel operations, rendering, tools, and persistence. No build step, external image service, or editor framework is required.

Run `pnpm playwright:install` once, then `pnpm test:paint:browser` from the repository root to check the document engine and editor interactions in headless Chromium. These checks do not call the OpenAI API; the regular `pnpm test` suite does not require a browser installation.
