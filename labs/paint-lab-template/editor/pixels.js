export function differenceBounds(before, after, width, height) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        before[i] !== after[i] ||
        before[i + 1] !== after[i + 1] ||
        before[i + 2] !== after[i + 2] ||
        before[i + 3] !== after[i + 3]
      ) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  return right < left
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function cropPixels(data, sourceWidth, rect) {
  const result = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * sourceWidth + rect.x) * 4;
    result.set(
      data.subarray(start, start + rect.width * 4),
      row * rect.width * 4,
    );
  }
  return result;
}

export function hexColor(hex, alpha = 255) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    alpha,
  ];
}

export function floodFill(data, width, height, x, y, color, tolerance = 0) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const seed = (y * width + x) * 4;
  const target = Array.from(data.subarray(seed, seed + 4));
  if (target.every((v, i) => v === color[i])) return false;
  const visited = new Uint8Array(width * height),
    queue = new Int32Array(width * height);
  let head = 0,
    tail = 1,
    changed = false;
  queue[0] = y * width + x;
  visited[queue[0]] = 1;
  const matches = (index) => {
    const offset = index * 4;
    // RGB values of fully transparent pixels have no visible meaning.
    if (target[3] === 0 && data[offset + 3] === 0) return true;
    return target.every(
      (v, channel) => Math.abs(data[offset + channel] - v) <= tolerance,
    );
  };
  while (head < tail) {
    const index = queue[head++];
    if (!matches(index)) continue;
    data.set(color, index * 4);
    changed = true;
    const column = index % width;
    for (const next of [
      column > 0 ? index - 1 : -1,
      column < width - 1 ? index + 1 : -1,
      index - width,
      index + width,
    ]) {
      if (next >= 0 && next < width * height && !visited[next]) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return changed;
}

export function countArtwork(data) {
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) count++;
  }
  return count;
}
