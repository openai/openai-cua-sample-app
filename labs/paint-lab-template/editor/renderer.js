import { clamp, documentPoint, zoomAt } from "./geometry.js";

export class Renderer {
  constructor(viewport, artboard, display, overlay, getDocument, onView) {
    Object.assign(this, {
      viewport,
      artboard,
      display,
      overlay,
      getDocument,
      onView,
    });
    this.view = { x: 0, y: 0, scale: 1 };
    this.fitted = true;
    this.frame = 0;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitted) this.fit();
    });
    this.resizeObserver.observe(viewport);
  }
  fit() {
    const doc = this.getDocument(),
      width = this.viewport.clientWidth,
      height = this.viewport.clientHeight;
    this.view.scale = Math.min(
      1,
      Math.max(
        0.1,
        Math.min((width - 48) / doc.width, (height - 48) / doc.height),
      ),
    );
    this.view.x = (width - doc.width * this.view.scale) / 2;
    this.view.y = (height - doc.height * this.view.scale) / 2;
    this.fitted = true;
    this.transform();
  }
  zoom(
    scale,
    point = {
      x: this.viewport.clientWidth / 2,
      y: this.viewport.clientHeight / 2,
    },
  ) {
    this.fitted = false;
    this.view = zoomAt(this.view, clamp(scale, 0.25, 4), point);
    this.transform();
  }
  pan(x, y) {
    this.fitted = false;
    this.view.x += x;
    this.view.y += y;
    this.transform();
  }
  transform() {
    const { x, y, scale } = this.view;
    this.artboard.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.onView(scale, this.fitted);
  }
  point(event) {
    const doc = this.getDocument();
    return documentPoint(
      event.clientX,
      event.clientY,
      this.display.getBoundingClientRect(),
      doc.width,
      doc.height,
    );
  }
  render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.getDocument().composite(this.display);
    });
  }
  renderNow() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.getDocument().composite(this.display);
  }
  clearOverlay() {
    this.overlay
      .getContext("2d")
      .clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
}
