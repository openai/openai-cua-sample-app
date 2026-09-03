import { describe, expect, it } from "vitest";
import { History } from "../../../../labs/paint-lab-template/editor/history.js";
import {
  documentPoint,
  constrainEnd,
  rectangle,
  zoomAt,
} from "../../../../labs/paint-lab-template/editor/geometry.js";
import {
  floodFill,
  differenceBounds,
  cropPixels,
  countArtwork,
} from "../../../../labs/paint-lab-template/editor/pixels.js";

describe("paint document coordinates", () => {
  it("maps the same point across zoom, pan, and CSS display sizes", () => {
    expect(
      documentPoint(
        300,
        350,
        { left: 100, top: 200, width: 512, height: 384 },
        1024,
        768,
      ),
    ).toEqual({ x: 400, y: 300 });
    expect(
      documentPoint(
        810,
        620,
        { left: 10, top: 20, width: 2048, height: 1536 },
        1024,
        768,
      ),
    ).toEqual({ x: 400, y: 300 });
  });
  it("keeps the inspected document point fixed while zooming", () => {
    const view = { x: 80, y: -40, scale: 0.5 },
      anchor = { x: 250, y: 180 },
      zoomed = zoomAt(view, 2, anchor);
    expect((anchor.x - zoomed.x) / zoomed.scale).toBe(
      (anchor.x - view.x) / view.scale,
    );
    expect((anchor.y - zoomed.y) / zoomed.scale).toBe(
      (anchor.y - view.y) / view.scale,
    );
  });
  it("clips reversed selections and constrains shapes", () => {
    expect(rectangle({ x: 80, y: 90 }, { x: -10, y: 20 }, 100, 100)).toEqual({
      x: 0,
      y: 20,
      width: 80,
      height: 70,
    });
    expect(
      constrainEnd({ x: 20, y: 30 }, { x: 40, y: 80 }, "ellipse", true),
    ).toEqual({ x: 70, y: 80 });
  });
});
describe("paint pixel operations", () => {
  it("fills only the connected area and respects a separating edge", () => {
    const pixels = new Uint8ClampedArray(5 * 3 * 4);
    for (let y = 0; y < 3; y++) pixels.set([0, 0, 0, 255], (y * 5 + 2) * 4);
    floodFill(pixels, 5, 3, 0, 1, [200, 50, 10, 255], 0);
    expect(Array.from(pixels.slice(0, 4))).toEqual([200, 50, 10, 255]);
    expect(Array.from(pixels.slice(12, 16))).toEqual([0, 0, 0, 0]);
    expect(Array.from(pixels.slice(8, 12))).toEqual([0, 0, 0, 255]);
  });
  it("bounds fill tolerance and handles same-color or out-of-bounds fills", () => {
    const pixels = new Uint8ClampedArray([
      100, 100, 100, 255, 106, 100, 100, 255, 150, 100, 100, 255,
    ]);
    floodFill(pixels, 3, 1, 0, 0, [0, 0, 0, 255], 10);
    expect(Array.from(pixels)).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 150, 100, 100, 255,
    ]);
    expect(floodFill(pixels, 3, 1, 0, 0, [0, 0, 0, 255])).toBe(false);
    expect(floodFill(pixels, 3, 1, -1, 0, [255, 0, 0, 255])).toBe(false);
  });
  it("stores only the changed rectangle for undo", () => {
    const before = new Uint8ClampedArray(4 * 4 * 4),
      after = before.slice();
    after.set([1, 2, 3, 255], (1 * 4 + 2) * 4);
    after.set([4, 5, 6, 255], (2 * 4 + 2) * 4);
    const bounds = differenceBounds(before, after, 4, 4);
    expect(bounds).toEqual({ x: 2, y: 1, width: 1, height: 2 });
    expect(Array.from(cropPixels(after, 4, bounds))).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
    ]);
    expect(differenceBounds(before, before, 4, 4)).toBeNull();
  });
  it("counts visible artwork against the white background", () => {
    expect(
      countArtwork(
        new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]),
      ),
    ).toBe(0);
    expect(
      countArtwork(
        new Uint8ClampedArray([255, 255, 255, 255, 254, 255, 255, 255]),
      ),
    ).toBe(1);
  });
});
describe("paint history", () => {
  it("restores saved state and discards the redo branch on a new edit", () => {
    let value = 0;
    const history = new History();
    const edit = (next) => {
      const old = value;
      value = next;
      history.push({
        label: "Stroke",
        bytes: 8,
        undo: () => {
          value = old;
        },
        redo: () => {
          value = next;
        },
      });
    };
    edit(1);
    history.markSaved();
    edit(2);
    expect(history.dirty).toBe(true);
    history.undo();
    expect(value).toBe(1);
    expect(history.dirty).toBe(false);
    history.redo();
    expect(value).toBe(2);
    history.undo();
    edit(3);
    expect(history.canRedo).toBe(false);
    expect(value).toBe(3);
    expect(history.entries).toHaveLength(2);
  });
  it("enforces history memory and action limits without undoing the current artwork", () => {
    let value = 0;
    const history = new History(() => {}, { maxActions: 2, maxBytes: 16 });
    for (let next = 1; next <= 4; next++) {
      const old = value;
      value = next;
      history.push({
        label: String(next),
        bytes: 8,
        undo: () => {
          value = old;
        },
        redo: () => {
          value = next;
        },
      });
    }
    expect(history.entries).toHaveLength(2);
    history.goTo(0);
    expect(value).toBe(2);
    history.goTo(2);
    expect(value).toBe(4);
    history.push({ label: "Large operation", bytes: 32, undo() {}, redo() {} });
    expect(history.entries).toHaveLength(0);
    expect(value).toBe(4);
  });
});
