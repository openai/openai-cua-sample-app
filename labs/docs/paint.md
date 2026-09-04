# Sketch Studio

A raster editor for the `paint-draw-poster` task. See the [task guide](scenarios.md#sketch-studio--paint) for a prompt and links to run either app.

## Drawing and editing

Choose a tool on the left, adjust its settings above the canvas, and choose colors or layers on the right. Drag to draw shapes; hold Shift for a circle or square. For text, click the canvas, type, then press Enter or **Apply text**. Use Undo or the eraser to correct mistakes.

Use **Toggle panels** if the color/layer controls are hidden, and **Fit** to bring the canvas into view. Draw through the visible controls.

## Saving

**Save draft** stores the layered document in browser storage. Wait for **Saved draft**. It restores after a reload in the same lab origin and browser context; a new run starts fresh. A failed save leaves the document unsaved.

**Export PNG** downloads the current artwork at 1024 × 768. It does not save the layered draft.

After normal model completion, both runners retain the last saved draft as `artwork/draft.sketch.json` and `artwork/draft.png` in the run workspace, even when verification is off. The activity log and successful run summary show the paths.

No saved draft means no retained files. Invalid image data or file-write errors fail the run. Cancellation or interruption can prevent capture. The JSON is available for inspection; there is no project-file import UI.

## Verification

Both apps check that the saved document matches the current layers and pixels, the saved layer images combine to the saved artwork, and the visible result is nonblank. Unsaved changes or a missing draft fail verification. Visual review is still needed to judge whether the artwork matches the prompt.

See [contributing](contributing.md#checks) to run the checks or change the lab. The editor source is in [`editor/`](../paint-lab-template/editor/).
