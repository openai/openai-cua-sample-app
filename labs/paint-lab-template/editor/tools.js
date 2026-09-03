import { canvas } from "./document.js";
import { clamp, constrainEnd, rectangle } from "./geometry.js";
import { floodFill, hexColor } from "./pixels.js";

export function drawShape(ctx, tool, start, end, settings) {
  ctx.save();
  ctx.strokeStyle = settings.color;
  ctx.fillStyle = settings.color;
  ctx.lineWidth = settings.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const x = Math.min(start.x, end.x),
    y = Math.min(start.y, end.y),
    width = Math.abs(end.x - start.x),
    height = Math.abs(end.y - start.y);
  ctx.beginPath();
  if (tool === "line") {
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  } else if (tool === "rectangle") ctx.rect(x, y, width, height);
  else
    ctx.ellipse(
      x + width / 2,
      y + height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2,
    );
  if (tool !== "line" && settings.shapeMode !== "outline") ctx.fill();
  if (tool === "line" || settings.shapeMode !== "fill") ctx.stroke();
  ctx.restore();
}

export class Tools {
  constructor({
    renderer,
    getDocument,
    settings,
    isBusy,
    notify,
    onSelection,
    onText,
    onColor,
    textEntry,
  }) {
    Object.assign(this, {
      renderer,
      getDocument,
      settings,
      isBusy,
      notify,
      onSelection,
      onText,
      onColor,
      textEntry,
    });
    this.gesture = null;
    this.selection = null;
    this.space = false;
    this.textPoint = null;
    const viewport = renderer.viewport;
    viewport.addEventListener("pointerdown", (event) => this.down(event));
    viewport.addEventListener("pointermove", (event) => this.move(event));
    viewport.addEventListener("pointerup", (event) => this.up(event));
    viewport.addEventListener("pointercancel", () => this.cancel());
    viewport.addEventListener("lostpointercapture", () => {
      if (this.gesture) this.cancel();
    });
    viewport.addEventListener("pointerleave", () => {
      if (!this.gesture) this.overlay();
    });
    viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const bounds = viewport.getBoundingClientRect();
          renderer.zoom(renderer.view.scale * Math.exp(-event.deltaY * 0.01), {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          });
        } else
          renderer.pan(
            -event.deltaX - (event.shiftKey ? event.deltaY : 0),
            event.shiftKey ? 0 : -event.deltaY,
          );
        this.overlay();
      },
      { passive: false },
    );
    window.addEventListener("blur", () => {
      this.space = false;
      viewport.classList.toggle("isHand", this.settings.tool === "hand");
      this.cancel();
    });
    textEntry.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelText();
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.commitText();
      }
    });
  }
  get doc() {
    return this.getDocument();
  }
  canPaint() {
    if (!this.doc.active.visible) {
      this.notify("Show the selected layer before drawing.");
      return false;
    }
    return true;
  }
  inside(point) {
    return (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < this.doc.width &&
      point.y < this.doc.height
    );
  }
  down(event) {
    if (
      event.button !== 0 ||
      this.isBusy() ||
      event.target.closest(".textComposer")
    )
      return;
    event.preventDefault();
    const start = this.renderer.point(event),
      tool = this.space ? "hand" : this.settings.tool;
    this.commitText();
    if (tool !== "hand" && !this.inside(start)) return;
    this.renderer.viewport.focus({ preventScroll: true });
    if (tool === "hand") {
      this.gesture = { tool, clientX: event.clientX, clientY: event.clientY };
    } else if (tool === "eyedropper") {
      const pixels = this.doc
        .composite()
        .getContext("2d")
        .getImageData(Math.floor(start.x), Math.floor(start.y), 1, 1).data;
      this.settings.color = `#${Array.from(pixels.subarray(0, 3), (n) => n.toString(16).padStart(2, "0")).join("")}`;
      this.onColor();
      return;
    } else if (tool === "text") {
      if (!this.canPaint()) return;
      this.textPoint = {
        x: clamp(start.x, 0, this.doc.width - 80),
        y: clamp(start.y, 0, this.doc.height - this.settings.fontSize),
      };
      this.textEntry.value = "";
      this.textEntry.parentElement.hidden = false;
      Object.assign(this.textEntry.parentElement.style, {
        left: `${this.textPoint.x}px`,
        top: `${this.textPoint.y}px`,
        maxWidth: `${this.doc.width - this.textPoint.x}px`,
      });
      Object.assign(this.textEntry.style, {
        color: this.settings.color,
        fontSize: `${this.settings.fontSize}px`,
        fontFamily: this.settings.font,
      });
      this.textEntry.focus();
      this.onText(true);
      return;
    } else if (tool === "select") {
      const rect = this.selection;
      if (
        rect &&
        rect.layerId === this.doc.activeId &&
        start.x >= rect.x &&
        start.y >= rect.y &&
        start.x < rect.x + rect.width &&
        start.y < rect.y + rect.height
      ) {
        if (!this.canPaint()) return;
        const transaction = this.doc.beginPixels("Move selection"),
          image = canvas(rect.width, rect.height);
        image
          .getContext("2d")
          .drawImage(
            this.doc.active.canvas,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            rect.width,
            rect.height,
          );
        this.gesture = {
          tool: "move-selection",
          start,
          end: start,
          transaction,
          image,
          rect: { ...rect },
        };
      } else {
        this.selection = null;
        this.gesture = { tool, start, end: start };
      }
    } else {
      if (!this.canPaint()) return;
      this.deselect();
      const transaction = this.doc.beginPixels(
        tool === "fill"
          ? "Fill"
          : tool === "eraser"
            ? "Erase"
            : `${tool[0].toUpperCase()}${tool.slice(1)}`,
      );
      if (tool === "fill") {
        const ctx = this.doc.active.canvas.getContext("2d", {
          willReadFrequently: true,
        });
        const pixels = ctx.getImageData(0, 0, this.doc.width, this.doc.height);
        floodFill(
          pixels.data,
          this.doc.width,
          this.doc.height,
          start.x,
          start.y,
          hexColor(this.settings.color),
          this.settings.tolerance,
        );
        ctx.putImageData(pixels, 0, 0);
        this.doc.commitPixels(transaction);
        return;
      }
      this.gesture = {
        tool,
        start,
        end: start,
        last: start,
        transaction,
        settings: { ...this.settings },
      };
      if (["brush", "pencil", "eraser"].includes(tool)) {
        this.gesture.stroke = canvas(this.doc.width, this.doc.height);
        this.stroke(start);
      }
    }
    this.renderer.viewport.setPointerCapture(event.pointerId);
    this.overlay();
  }
  stroke(point) {
    const gesture = this.gesture,
      settings = gesture.settings,
      ctx = gesture.stroke.getContext("2d");
    ctx.strokeStyle = settings.color;
    ctx.fillStyle = settings.color;
    ctx.lineWidth = settings.size;
    ctx.lineCap = gesture.tool === "pencil" ? "square" : "round";
    ctx.lineJoin = "round";
    const position =
      gesture.tool === "pencil"
        ? { x: Math.floor(point.x) + 0.5, y: Math.floor(point.y) + 0.5 }
        : point;
    ctx.beginPath();
    ctx.moveTo(gesture.last.x, gesture.last.y);
    ctx.lineTo(position.x, position.y);
    ctx.stroke();
    if (gesture.tool === "pencil")
      ctx.fillRect(
        Math.floor(position.x - settings.size / 2),
        Math.floor(position.y - settings.size / 2),
        settings.size,
        settings.size,
      );
    else {
      ctx.beginPath();
      ctx.arc(position.x, position.y, settings.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    gesture.last = position;
    const layer = gesture.transaction.layer.canvas.getContext("2d");
    layer.putImageData(gesture.transaction.before, 0, 0);
    layer.save();
    layer.globalCompositeOperation =
      gesture.tool === "eraser" ? "destination-out" : "source-over";
    layer.globalAlpha = gesture.tool === "brush" ? settings.opacity : 1;
    layer.drawImage(gesture.stroke, 0, 0);
    layer.restore();
    this.renderer.render();
  }
  move(event) {
    const point = this.renderer.point(event),
      gesture = this.gesture;
    if (!gesture) {
      this.overlay(point);
      return;
    }
    if (gesture.tool === "hand") {
      this.renderer.pan(
        event.clientX - gesture.clientX,
        event.clientY - gesture.clientY,
      );
      gesture.clientX = event.clientX;
      gesture.clientY = event.clientY;
      return;
    }
    gesture.end = constrainEnd(
      gesture.start,
      point,
      gesture.tool,
      event.shiftKey,
    );
    if (gesture.stroke) {
      const events = event.getCoalescedEvents?.() || [];
      for (const sample of events.length ? events : [event])
        this.stroke(this.renderer.point(sample));
    } else if (gesture.tool === "move-selection") {
      const { rect, image, start, transaction } = gesture;
      const x = clamp(
        Math.round(rect.x + point.x - start.x),
        0,
        this.doc.width - rect.width,
      );
      const y = clamp(
        Math.round(rect.y + point.y - start.y),
        0,
        this.doc.height - rect.height,
      );
      const ctx = transaction.layer.canvas.getContext("2d");
      ctx.putImageData(transaction.before, 0, 0);
      ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
      ctx.drawImage(image, x, y);
      this.selection = { ...rect, x, y };
      this.renderer.render();
    }
    this.overlay(point);
  }
  up(event) {
    if (!this.gesture) return;
    this.move(event);
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture.tool === "select") {
      const rect = rectangle(
        gesture.start,
        gesture.end,
        this.doc.width,
        this.doc.height,
      );
      this.selection =
        rect.width && rect.height
          ? { ...rect, layerId: this.doc.activeId }
          : null;
    } else if (gesture.transaction) {
      if (["line", "rectangle", "ellipse"].includes(gesture.tool))
        drawShape(
          gesture.transaction.layer.canvas.getContext("2d"),
          gesture.tool,
          gesture.start,
          gesture.end,
          gesture.settings,
        );
      this.doc.commitPixels(gesture.transaction);
    }
    this.overlay();
    this.onSelection(this.selection);
    if (this.renderer.viewport.hasPointerCapture(event.pointerId))
      this.renderer.viewport.releasePointerCapture(event.pointerId);
  }
  cancel() {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture?.transaction) this.doc.cancelPixels(gesture.transaction);
    if (gesture?.tool === "move-selection") this.selection = gesture.rect;
    this.overlay();
    this.onSelection(this.selection);
  }
  deselect() {
    this.selection = null;
    this.overlay();
    this.onSelection(null);
  }
  selectAll() {
    this.selection = {
      x: 0,
      y: 0,
      width: this.doc.width,
      height: this.doc.height,
      layerId: this.doc.activeId,
    };
    this.overlay();
    this.onSelection(this.selection);
  }
  editSelection(duplicate) {
    const rect = this.selection;
    if (!rect || rect.layerId !== this.doc.activeId || !this.canPaint()) return;
    const transaction = this.doc.beginPixels(
        duplicate ? "Duplicate selection" : "Delete selection",
      ),
      ctx = this.doc.active.canvas.getContext("2d");
    if (duplicate) {
      const image = canvas(rect.width, rect.height);
      image
        .getContext("2d")
        .drawImage(
          this.doc.active.canvas,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          0,
          0,
          rect.width,
          rect.height,
        );
      this.selection = {
        ...rect,
        x: clamp(rect.x + 16, 0, this.doc.width - rect.width),
        y: clamp(rect.y + 16, 0, this.doc.height - rect.height),
      };
      ctx.drawImage(image, this.selection.x, this.selection.y);
    } else {
      ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
      this.selection = null;
    }
    this.doc.commitPixels(transaction);
    this.overlay();
    this.onSelection(this.selection);
  }
  commitText() {
    if (!this.textPoint) return;
    const value = this.textEntry.value;
    if (value.trim()) {
      const transaction = this.doc.beginPixels("Text"),
        ctx = this.doc.active.canvas.getContext("2d");
      ctx.save();
      ctx.font = `${this.settings.fontSize}px ${this.settings.font}`;
      ctx.textBaseline = "top";
      ctx.fillStyle = this.settings.color;
      value
        .split("\n")
        .forEach((line, index) =>
          ctx.fillText(
            line,
            this.textPoint.x,
            this.textPoint.y + index * this.settings.fontSize * 1.2,
          ),
        );
      ctx.restore();
      this.doc.commitPixels(transaction);
    }
    this.cancelText();
  }
  cancelText() {
    this.textPoint = null;
    this.textEntry.parentElement.hidden = true;
    this.onText(false);
  }
  overlay(point) {
    const ctx = this.renderer.overlay.getContext("2d"),
      scale = this.renderer.view.scale;
    this.renderer.clearOverlay();
    const gesture = this.gesture;
    if (gesture && ["line", "rectangle", "ellipse"].includes(gesture.tool))
      drawShape(
        ctx,
        gesture.tool,
        gesture.start,
        gesture.end,
        gesture.settings,
      );
    const selection =
      gesture?.tool === "select"
        ? rectangle(gesture.start, gesture.end, this.doc.width, this.doc.height)
        : this.selection;
    if (selection) {
      ctx.save();
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(
        selection.x,
        selection.y,
        selection.width,
        selection.height,
      );
      ctx.setLineDash([5 / scale, 5 / scale]);
      ctx.strokeStyle = "#15171b";
      ctx.strokeRect(
        selection.x,
        selection.y,
        selection.width,
        selection.height,
      );
      ctx.restore();
    } else if (
      !gesture &&
      point &&
      this.inside(point) &&
      ["brush", "pencil", "eraser"].includes(this.settings.tool)
    ) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        Math.max(2 / scale, this.settings.size / 2),
        0,
        Math.PI * 2,
      );
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = "#202228";
      ctx.stroke();
      ctx.restore();
    }
  }
}
