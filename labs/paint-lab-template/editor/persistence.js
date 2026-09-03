import { canvas, PaintDocument } from "./document.js";
import { countArtwork } from "./pixels.js";

async function hash(data) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function snapshotDocument(doc) {
  // Capture every buffer synchronously before hashing, so a snapshot is one committed state.
  const layers = doc.layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    png: layer.canvas.toDataURL("image/png"),
    pixels: layer.canvas
      .getContext("2d")
      .getImageData(0, 0, doc.width, doc.height).data,
  }));
  const composite = doc.composite(),
    pixels = composite
      .getContext("2d")
      .getImageData(0, 0, doc.width, doc.height).data;
  const snapshot = {
    version: 2,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    layers: [],
    compositePng: composite.toDataURL("image/png"),
    compositePixelHash: "",
    paintedPixelCount: countArtwork(pixels),
  };
  snapshot.layers = await Promise.all(
    layers.map(async ({ pixels: layerPixels, ...layer }) => ({
      ...layer,
      pixelHash: await hash(layerPixels),
    })),
  );
  snapshot.compositePixelHash = await hash(pixels);
  return snapshot;
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sketch-studio", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("drafts"))
        request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = action(tx.objectStore("drafts"));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(tx.error || new Error("Draft storage transaction was aborted."));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const loadDraft = () =>
  transact("readonly", (store) => store.get("current"));
export const storeDraft = (draft) =>
  transact("readwrite", (store) => store.put(draft, "current"));
export const removeDraft = () =>
  transact("readwrite", (store) => store.delete("current"));

export async function decodePng(url, width, height) {
  if (typeof url !== "string" || !url.startsWith("data:image/png;base64,"))
    throw new Error("Invalid image in saved draft.");
  const image = new Image();
  image.src = url;
  await image.decode();
  if (image.naturalWidth !== width || image.naturalHeight !== height)
    throw new Error("Saved image dimensions do not match the document.");
  const result = canvas(width, height);
  result.getContext("2d").drawImage(image, 0, 0);
  return result;
}
export async function restoreDocument(draft) {
  const snapshot = draft?.document;
  if (
    draft?.version !== 2 ||
    snapshot?.version !== 2 ||
    snapshot.width !== 1024 ||
    snapshot.height !== 768 ||
    !Array.isArray(snapshot.layers) ||
    snapshot.layers.length < 1 ||
    snapshot.layers.length > 8
  )
    throw new Error("This saved draft is not supported.");
  const doc = new PaintDocument(snapshot.width, snapshot.height);
  doc.name = String(snapshot.name).slice(0, 80);
  const ids = new Set();
  doc.layers = await Promise.all(
    snapshot.layers.map(async (layer) => {
      if (
        typeof layer.id !== "string" ||
        ids.has(layer.id) ||
        typeof layer.name !== "string" ||
        typeof layer.visible !== "boolean" ||
        !Number.isFinite(layer.opacity) ||
        layer.opacity < 0 ||
        layer.opacity > 1
      )
        throw new Error("Saved layer is invalid.");
      ids.add(layer.id);
      return {
        id: layer.id,
        name: layer.name.slice(0, 80),
        visible: layer.visible,
        opacity: layer.opacity,
        canvas: await decodePng(layer.png, doc.width, doc.height),
      };
    }),
  );
  doc.activeId = doc.layers.at(-1).id;
  const restored = await snapshotDocument(doc);
  if (
    restored.compositePixelHash !== snapshot.compositePixelHash ||
    restored.layers.some(
      (layer, i) => layer.pixelHash !== snapshot.layers[i].pixelHash,
    )
  )
    throw new Error("Saved draft image data is inconsistent.");
  doc.history.markSaved();
  return doc;
}
export function downloadPng(doc) {
  const link = document.createElement("a");
  link.download = `${doc.name.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Sketch"}.png`;
  link.href = doc.composite().toDataURL("image/png");
  link.click();
}
