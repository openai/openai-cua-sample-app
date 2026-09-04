import {
  PaintDocument,
  canvas,
} from "../../../paint-lab-template/editor/document.js";
import { Tools } from "../../../paint-lab-template/editor/tools.js";
import {
  snapshotDocument,
  restoreDocument,
  storeDraft,
  loadDraft,
  removeDraft,
  decodePng,
} from "../../../paint-lab-template/editor/persistence.js";

const tests = [];
const test = (name, run) => tests.push({ name, run });
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const pixels = (element) =>
  element.getContext("2d").getImageData(0, 0, element.width, element.height)
    .data;
const pixel = (element, x, y) => [
  ...element.getContext("2d").getImageData(x, y, 1, 1).data,
];
const equal = (actual, expected, message) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: ${JSON.stringify(actual)}`,
  );
function fillLayer(
  doc,
  color,
  x = 0,
  y = 0,
  width = doc.width,
  height = doc.height,
) {
  const transaction = doc.beginPixels("Fixture rectangle");
  const ctx = doc.active.canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
  doc.commitPixels(transaction);
}
function fixture(size = 64) {
  const doc = new PaintDocument(size, size),
    overlay = canvas(size, size),
    target = document.createElement("div");
  const textEntry = document.createElement("textarea");
  target.append(textEntry);
  const settings = {
    tool: "brush",
    size: 6,
    color: "#ff0000",
    opacity: 1,
    shapeMode: "fill",
    tolerance: 0,
    fontSize: 18,
    font: "Arial",
  };
  let captured = false;
  const viewport = {
    addEventListener() {},
    focus() {},
    setPointerCapture() {
      captured = true;
    },
    hasPointerCapture() {
      return captured;
    },
    releasePointerCapture() {
      captured = false;
    },
    classList: { toggle() {} },
  };
  const renderer = {
    viewport,
    overlay,
    view: { scale: 1 },
    point: (event) => ({ x: event.clientX, y: event.clientY }),
    render() {},
    clearOverlay() {
      overlay.getContext("2d").clearRect(0, 0, size, size);
    },
  };
  const tools = new Tools({
    renderer,
    getDocument: () => doc,
    settings,
    isBusy: () => false,
    notify() {},
    onSelection() {},
    onText() {},
    onColor() {},
    textEntry,
  });
  const event = (x, y, shiftKey = false) => ({
    button: 0,
    clientX: x,
    clientY: y,
    shiftKey,
    pointerId: 1,
    target,
    preventDefault() {},
  });
  const drag = (x, y, toX, toY) => {
    tools.down(event(x, y));
    tools.move(event(toX, toY));
    tools.up(event(toX, toY));
  };
  return { doc, tools, settings, overlay, textEntry, event, drag };
}

test("Sparse pointer samples produce a continuous stroke and one undo step", () => {
  const { doc, drag } = fixture();
  drag(8, 20, 56, 20);
  for (let x = 8; x < 56; x++)
    assert(pixel(doc.active.canvas, x, 20)[3] === 255, "Gap in stroke");
  assert(
    doc.history.entries.length === 1,
    "Stroke split into multiple undo entries",
  );
  doc.history.undo();
  assert(!pixels(doc.active.canvas).some(Boolean), "Undo left painted pixels");
  doc.history.redo();
  assert(pixel(doc.active.canvas, 30, 20)[0] === 255, "Redo lost the stroke");
});
test("Cancelled strokes restore pixels and preserve history", () => {
  const { doc, tools, event } = fixture();
  tools.down(event(8, 8));
  tools.move(event(50, 50));
  tools.cancel();
  assert(!pixels(doc.active.canvas).some(Boolean), "Cancelled stroke remained");
  assert(!doc.history.canUndo, "Cancellation added history");
});
test("Shape preview stays separate; constrained shapes commit and undo", () => {
  const { doc, tools, settings, event, overlay } = fixture();
  settings.tool = "rectangle";
  tools.down(event(8, 8));
  tools.move(event(40, 24, true));
  assert(!pixels(doc.active.canvas).some(Boolean), "Preview modified artwork");
  assert(pixels(overlay).some(Boolean), "No shape preview");
  tools.up(event(40, 24, true));
  assert(
    pixel(doc.active.canvas, 30, 35)[3] === 255,
    "Shift did not constrain to square",
  );
  doc.history.undo();
  assert(!pixels(doc.active.canvas).some(Boolean), "Undo failed");
});
test("Selection moves, duplicates, deletes, and undoes actual pixels", () => {
  const { doc, tools, settings, drag } = fixture();
  fillLayer(doc, "#ff0000", 4, 4, 8, 8);
  settings.tool = "select";
  drag(3, 3, 13, 13);
  drag(6, 6, 26, 26);
  assert(pixel(doc.active.canvas, 6, 6)[3] === 0, "Move left source pixels");
  assert(
    pixel(doc.active.canvas, 26, 26)[3] === 255,
    "Move lost destination pixels",
  );
  doc.history.undo();
  assert(
    pixel(doc.active.canvas, 6, 6)[3] === 255,
    "Undo failed to restore selection source",
  );
  tools.selection = { x: 4, y: 4, width: 8, height: 8, layerId: doc.activeId };
  tools.editSelection(true);
  assert(pixel(doc.active.canvas, 23, 23)[3] === 255, "Duplicate missing");
  tools.editSelection(false);
  assert(pixel(doc.active.canvas, 23, 23)[3] === 0, "Delete selection failed");
  assert(pixel(doc.active.canvas, 6, 6)[3] === 255, "Delete damaged original");
});
test("Layers composite in order, honor visibility/opacity, and preserve undo", () => {
  const { doc } = fixture();
  fillLayer(doc, "#ff0000");
  doc.addLayer();
  fillLayer(doc, "#0000ff");
  equal(pixel(doc.composite(), 5, 5), [0, 0, 255, 255], "Top layer");
  doc.editMetadata("Opacity", doc.active, "opacity", 0.5);
  const mixed = pixel(doc.composite(), 5, 5);
  assert(
    Math.abs(mixed[0] - 127) <= 1 && Math.abs(mixed[2] - 128) <= 1,
    "Incorrect opacity compositing",
  );
  doc.editMetadata("Hide", doc.active, "visible", false);
  equal(pixel(doc.composite(), 5, 5), [255, 0, 0, 255], "Visibility");
  doc.history.undo();
  doc.reorderLayer(doc.activeId, 0);
  equal(pixel(doc.composite(), 5, 5), [255, 0, 0, 255], "Layer order");
  doc.history.undo();
  assert(pixel(doc.composite(), 5, 5)[2] > 100, "Reorder undo failed");
  doc.active.name = "a".repeat(80);
  doc.addLayer(true);
  assert(
    doc.active.name.length <= 80,
    "Duplicating a long name breaks the save schema",
  );
});
test("Eraser reveals lower layers and undo restores the top layer", () => {
  const { doc, settings, drag } = fixture();
  fillLayer(doc, "#ff0000");
  doc.addLayer();
  fillLayer(doc, "#0000ff");
  settings.tool = "eraser";
  drag(8, 24, 56, 24);
  equal(pixel(doc.composite(), 30, 24), [255, 0, 0, 255], "Erasure");
  doc.history.undo();
  equal(pixel(doc.composite(), 30, 24), [0, 0, 255, 255], "Erase undo");
});
test("Fill is bounded by existing pixels and commits once", () => {
  const { doc, tools, settings, event } = fixture();
  fillLayer(doc, "#000000", 31, 0, 2, 64);
  settings.tool = "fill";
  tools.down(event(5, 5));
  equal(pixel(doc.active.canvas, 5, 5), [255, 0, 0, 255], "Fill color");
  assert(pixel(doc.active.canvas, 50, 5)[3] === 0, "Fill crossed boundary");
  doc.history.undo();
  assert(pixel(doc.active.canvas, 5, 5)[3] === 0, "Fill undo failed");
  assert(
    pixel(doc.active.canvas, 31, 5)[3] === 255,
    "Fill undo removed boundary",
  );
});
test("Text commits raster pixels in one transaction and cancellation leaves no mark", () => {
  const { doc, tools, settings, textEntry, event } = fixture();
  settings.tool = "text";
  tools.down(event(3, 3));
  textEntry.value = "Hi";
  tools.commitText();
  assert(pixels(doc.active.canvas).some(Boolean), "Text did not draw");
  assert(doc.history.entries.length === 1, "Text history incorrect");
  doc.history.undo();
  tools.down(event(3, 3));
  textEntry.value = "Cancel";
  tools.cancelText();
  assert(!pixels(doc.active.canvas).some(Boolean), "Cancelled text remained");
});
test("Saved translucent PNGs round-trip with matching hashes and 1024 × 768 pixels", async () => {
  const doc = new PaintDocument();
  fillLayer(doc, "rgba(62,173,217,0.37)", 100, 120, 340, 180);
  doc.addLayer();
  fillLayer(doc, "#ed787d", 260, 170, 200, 150);
  doc.active.opacity = 0.6;
  const saved = await snapshotDocument(doc);
  for (let i = 0; i < doc.layers.length; i++) {
    const before = pixels(doc.layers[i].canvas),
      after = pixels(await decodePng(saved.layers[i].png, 1024, 768));
    const index = before.findIndex((value, j) => value !== after[j]);
    assert(
      index === -1,
      `Layer ${i} PNG roundtrip changed channel ${index}: ${before[index]} → ${after[index]}; RGBA ${[...before.slice(index - (index % 4), index - (index % 4) + 4)]} → ${[...after.slice(index - (index % 4), index - (index % 4) + 4)]}`,
    );
  }
  const restored = await restoreDocument({
    version: 2,
    savedAt: new Date().toISOString(),
    document: saved,
  });
  const roundTrip = await snapshotDocument(restored);
  equal(
    roundTrip.layers.map((layer) => layer.pixelHash),
    saved.layers.map((layer) => layer.pixelHash),
    "Layer hashes",
  );
  assert(
    roundTrip.compositePixelHash === saved.compositePixelHash,
    "Composite changed after reload",
  );
  const composite = await decodePng(saved.compositePng, 1024, 768);
  equal(pixel(composite, 0, 0), [255, 255, 255, 255], "PNG background");
  assert(saved.paintedPixelCount > 0, "Missing artwork");
  assert(!restored.history.dirty, "Restored draft marked dirty");
});
test("Completed storage retains an immutable draft and detects corrupt images", async () => {
  await removeDraft();
  const doc = new PaintDocument();
  fillLayer(doc, "#537dc4", 10, 10, 30, 30);
  const snapshot = await snapshotDocument(doc);
  const draft = {
    version: 2,
    savedAt: new Date().toISOString(),
    document: snapshot,
  };
  await storeDraft(draft);
  fillLayer(doc, "#ff0000", 10, 10, 30, 30);
  const current = await snapshotDocument(doc),
    stored = await loadDraft();
  assert(
    stored.document.compositePixelHash !== current.compositePixelHash,
    "Saved draft changed with live pixels",
  );
  assert(
    stored.document.compositePixelHash === snapshot.compositePixelHash,
    "Storage changed draft",
  );
  let writeFailed = false;
  try {
    await storeDraft({ uncloneable: () => null });
  } catch {
    writeFailed = true;
  }
  assert(writeFailed, "Invalid draft write did not reject");
  assert(
    (await loadDraft()).document.compositePixelHash === snapshot.compositePixelHash,
    "Failed write replaced the completed draft",
  );
  let rejected = false;
  try {
    await restoreDocument({
      ...stored,
      document: { ...stored.document, compositePixelHash: "0".repeat(64) },
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "Corrupt draft accepted");
  await removeDraft();
  assert(
    (await loadDraft()) === undefined,
    "New document did not clear storage",
  );
});

let passed = 0;
for (const { name, run } of tests) {
  const row = document.createElement("li");
  row.textContent = name;
  document.querySelector("#results").append(row);
  try {
    await run();
    row.dataset.result = "pass";
    row.textContent = `PASS — ${name}`;
    passed++;
  } catch (error) {
    row.dataset.result = "fail";
    row.textContent = `FAIL — ${name}: ${error.message}`;
  }
}
document.querySelector("#summary").textContent =
  `${passed} / ${tests.length} checks passed`;
document.title = `${passed}/${tests.length} — Sketch Studio browser checks`;
