import { History } from "./history.js";
import { cropPixels, differenceBounds } from "./pixels.js";

export function canvas(width, height) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  // Keep layer, decoded-image, and history buffers on the same pixel path.
  element.getContext("2d", { willReadFrequently: true });
  return element;
}

export class PaintDocument extends EventTarget {
  constructor(width = 1024, height = 768) {
    super();
    this.width = width;
    this.height = height;
    this.name = "Untitled";
    this.layers = [];
    this.history = new History(() => this.changed());
    this.layers.push(this.createLayer("Layer 1"));
    this.activeId = this.layers[0].id;
  }
  get active() {
    return (
      this.layers.find((layer) => layer.id === this.activeId) ||
      this.layers.at(-1)
    );
  }
  changed() {
    this.dispatchEvent(new Event("change"));
  }
  createLayer(name) {
    return {
      id: crypto.randomUUID(),
      name: name.slice(0, 80),
      visible: true,
      opacity: 1,
      canvas: canvas(this.width, this.height),
    };
  }
  composite(target = canvas(this.width, this.height)) {
    const ctx = target.getContext("2d", { willReadFrequently: true });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.width, this.height);
    for (const layer of this.layers)
      if (layer.visible) {
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(layer.canvas, 0, 0);
      }
    ctx.globalAlpha = 1;
    return target;
  }
  beginPixels(label) {
    const layer = this.active;
    return {
      label,
      layer,
      before: layer.canvas
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, this.width, this.height),
    };
  }
  commitPixels(transaction) {
    const { layer, before, label } = transaction;
    const ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
    const after = ctx.getImageData(0, 0, this.width, this.height);
    const rect = differenceBounds(
      before.data,
      after.data,
      this.width,
      this.height,
    );
    if (!rect) {
      this.changed();
      return false;
    }
    const oldData = new ImageData(
      cropPixels(before.data, this.width, rect),
      rect.width,
      rect.height,
    );
    const newData = new ImageData(
      cropPixels(after.data, this.width, rect),
      rect.width,
      rect.height,
    );
    const apply = (data) => {
      ctx.putImageData(data, rect.x, rect.y);
      this.activeId = layer.id;
    };
    this.history.push({
      label,
      bytes: oldData.data.byteLength + newData.data.byteLength,
      undo: () => apply(oldData),
      redo: () => apply(newData),
    });
    return true;
  }
  cancelPixels(transaction) {
    transaction.layer.canvas
      .getContext("2d")
      .putImageData(transaction.before, 0, 0);
    this.changed();
  }
  clearLayer() {
    const transaction = this.beginPixels("Clear layer");
    this.active.canvas
      .getContext("2d")
      .clearRect(0, 0, this.width, this.height);
    this.commitPixels(transaction);
  }
  editMetadata(label, object, key, value) {
    const before = object[key];
    if (before === value) return;
    object[key] = value;
    this.history.push({
      label,
      bytes: 0,
      undo: () => {
        object[key] = before;
      },
      redo: () => {
        object[key] = value;
      },
    });
  }
  changeLayers(label, next, activeId, bytes = 0) {
    const before = this.layers.slice(),
      previousId = this.activeId;
    const apply = (layers, id) => {
      this.layers = layers.slice();
      this.activeId = id;
    };
    apply(next, activeId);
    this.history.push({
      label,
      bytes,
      undo: () => apply(before, previousId),
      redo: () => apply(next, activeId),
    });
  }
  addLayer(duplicate = false) {
    if (this.layers.length >= 8) return false;
    const layer = this.createLayer(
      duplicate
        ? `${this.active.name} copy`
        : `Layer ${this.layers.length + 1}`,
    );
    if (duplicate) {
      layer.canvas.getContext("2d").drawImage(this.active.canvas, 0, 0);
      layer.opacity = this.active.opacity;
      layer.visible = this.active.visible;
    }
    const next = this.layers.slice();
    next.splice(next.indexOf(this.active) + 1, 0, layer);
    this.changeLayers(
      duplicate ? "Duplicate layer" : "Add layer",
      next,
      layer.id,
      this.width * this.height * 4,
    );
    return true;
  }
  deleteLayer() {
    if (this.layers.length === 1) {
      this.clearLayer();
      return;
    }
    const next = this.layers.filter((layer) => layer !== this.active);
    this.changeLayers(
      "Delete layer",
      next,
      next.at(-1).id,
      this.width * this.height * 4,
    );
  }
  reorderLayer(id, index) {
    const layer = this.layers.find((item) => item.id === id),
      from = this.layers.indexOf(layer);
    if (!layer || from === index || index < 0 || index >= this.layers.length)
      return;
    const next = this.layers.slice();
    next.splice(from, 1);
    next.splice(index, 0, layer);
    this.changeLayers("Reorder layer", next, id);
  }
}
