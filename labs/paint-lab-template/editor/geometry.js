export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function documentPoint(clientX, clientY, rect, width, height) {
  return {
    x: ((clientX - rect.left) * width) / rect.width,
    y: ((clientY - rect.top) * height) / rect.height,
  };
}

export function rectangle(a, b, width, height) {
  const x = clamp(Math.floor(Math.min(a.x, b.x)), 0, width);
  const y = clamp(Math.floor(Math.min(a.y, b.y)), 0, height);
  return {
    x,
    y,
    width: clamp(Math.ceil(Math.max(a.x, b.x)), 0, width) - x,
    height: clamp(Math.ceil(Math.max(a.y, b.y)), 0, height) - y,
  };
}

export function constrainEnd(start, end, tool, constrained) {
  if (!constrained) return end;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  if (tool === "line") {
    const angle =
      (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
    const length = Math.hypot(dx, dy);
    return {
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    };
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * size,
    y: start.y + Math.sign(dy || 1) * size,
  };
}

export function zoomAt(view, nextScale, point) {
  const ratio = nextScale / view.scale;
  return {
    scale: nextScale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}
