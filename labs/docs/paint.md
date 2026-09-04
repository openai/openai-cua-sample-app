# Sketch Studio

A raster editor for the `paint-draw-poster` task. See the [task guide](scenarios.md#sketch-studio--paint) for a prompt and links to run either app.

## Drawing and editing

Choose a tool on the left, adjust its settings above the canvas, and choose colors or layers on the right. Drag to draw shapes; hold Shift for a circle or square. For text, click the canvas, type, then press Enter or **Apply text**. Use Undo or the eraser to correct mistakes.

Use **Toggle panels** if the color/layer controls are hidden, and **Fit** to bring the canvas into view. Draw through the visible controls.

## Saving

**Save draft** stores the layered document in browser storage. Wait for **Saved draft**. It restores after a reload in the same lab origin and browser context; a new run starts fresh. A failed save leaves the document unsaved.

## Inspecting the result

Inspect the final screenshot and model response to judge whether the drawing matches the prompt. Use the screenshot timeline and **Replay JSON** to review the run. **Run finished** reports normal execution and cleanup, not a grade for the drawing.

See [contributing](contributing.md#checks) to run the checks or change the lab. The editor source is in [`editor/`](../paint-lab-template/editor/).
