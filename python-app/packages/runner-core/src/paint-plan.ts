import { getLabInstructions } from "@cua-sample/scenario-kit";
/// <reference lib="dom" />
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { type BrowserSession } from "@cua-sample/browser-runtime";
import {
  paintDocumentSnapshotSchema,
  paintSaveRecordSchema,
  type PaintDocumentSnapshot,
  type PaintSaveRecord,
} from "@cua-sample/replay-schema";

export type { PaintSaveRecord } from "@cua-sample/replay-schema";
export const buildPaintRunnerPrompt = (prompt: string) => prompt.trim();

export function buildPaintCodeInstructions(currentUrl: string) {
  return [
    "You are operating a persistent Python/PyAutoGUI desktop session for a GPT-5.6 CUA demo harness.",
    "You must use the exec_py tool before you answer.",
    "Observe the current interface with pyautogui.screenshot(), then use PyAutoGUI mouse and keyboard controls. Coordinates refer to the full desktop screenshot.",
    `The lab is already open at ${currentUrl}.`,
    ...getLabInstructions("paint"),
  ].join("\n");
}

export async function readPaintDocumentSnapshot(
  session: BrowserSession,
): Promise<PaintDocumentSnapshot> {
  const value = await session.page.evaluate(async () => {
    const scope = globalThis as unknown as {
      __paintReadDocumentSnapshot?: () => Promise<unknown>;
    };
    if (typeof scope.__paintReadDocumentSnapshot !== "function") {
      throw new Error("Paint document accessor is unavailable.");
    }
    return scope.__paintReadDocumentSnapshot();
  });
  const parsed = paintDocumentSnapshotSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Paint verification failed. The live document snapshot is invalid.",
    );
  return parsed.data;
}
export async function readPaintSaveRecord(
  session: BrowserSession,
): Promise<PaintSaveRecord | null> {
  const value = await session.page.evaluate(() => {
    const scope = globalThis as unknown as {
      __paintReadSaveRecord?: () => unknown;
    };
    if (typeof scope.__paintReadSaveRecord !== "function") {
      throw new Error("Paint save accessor is unavailable.");
    }
    return scope.__paintReadSaveRecord();
  });
  if (value === null) return null;
  const parsed = paintSaveRecordSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Paint verification failed. The saved draft is invalid.");
  return parsed.data;
}

export function assertMatchingPaintDocuments(
  live: PaintDocumentSnapshot,
  saved: PaintDocumentSnapshot,
) {
  const signature = (snapshot: PaintDocumentSnapshot) =>
    JSON.stringify({
      version: snapshot.version,
      name: snapshot.name,
      width: snapshot.width,
      height: snapshot.height,
      layers: snapshot.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        pixelHash: layer.pixelHash,
      })),
      compositePixelHash: snapshot.compositePixelHash,
      paintedPixelCount: snapshot.paintedPixelCount,
    });
  if (signature(live) !== signature(saved))
    throw new Error(
      "Paint verification failed. The saved draft does not match the current document. Save the latest changes.",
    );
  if (live.paintedPixelCount === 0)
    throw new Error("Paint verification failed. The saved artwork is blank.");
}

// Decode the actual saved PNGs in isolated canvases. Recompose them independently of app state.
export async function validatePaintImageData(
  session: BrowserSession,
  snapshot: PaintDocumentSnapshot,
) {
  // Keep this browser program as source: tsx's keepNames transform otherwise
  // injects Node-side helpers into nested functions serialized by Playwright.
  const browserProgram = `async (saved) => {
    const hash = async (pixels) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(pixels)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    const newCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = saved.width;
      canvas.height = saved.height;
      return canvas;
    };
    const decode = async (png) => {
      const image = new Image();
      image.src = png;
      await image.decode();
      if (
        image.naturalWidth !== saved.width ||
        image.naturalHeight !== saved.height
      )
        throw new Error("Saved PNG dimensions are incorrect.");
      const canvas = newCanvas();
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
      return canvas;
    };
    const composite = newCanvas(),
      ctx = composite.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, saved.width, saved.height);
    for (const layer of saved.layers) {
      const canvas = await decode(layer.png),
        pixels = canvas
          .getContext("2d", { willReadFrequently: true })
          .getImageData(0, 0, saved.width, saved.height).data;
      if ((await hash(pixels)) !== layer.pixelHash)
        return {
          valid: false,
          reason: "A saved layer image does not match its pixel hash.",
        };
      if (layer.visible) {
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(canvas, 0, 0);
      }
    }
    const decoded = await decode(saved.compositePng),
      pixels = decoded
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, saved.width, saved.height).data;
    const compositePixels = ctx.getImageData(
      0,
      0,
      saved.width,
      saved.height,
    ).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255)
        count++;
    const decodedHash = await hash(pixels);
    const valid =
      decodedHash === saved.compositePixelHash &&
      (await hash(compositePixels)) === decodedHash &&
      count === saved.paintedPixelCount;
    return {
      valid,
      reason:
        "The saved PNG is inconsistent with the saved layers or pixel metadata.",
    };
  }`;
  let result: { valid: boolean; reason: string };
  try {
    result = await session.page.evaluate<typeof result>(
      `(${browserProgram})(${JSON.stringify(snapshot)})`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Paint verification failed. Could not validate saved PNG data: ${detail}`, {
      cause: error,
    });
  }
  if (!result.valid) {
    throw new Error(`Paint verification failed. ${result.reason}`);
  }
}

export async function assertPaintOutcome(session: BrowserSession) {
  await session.page.waitForFunction(
    () =>
      (globalThis as unknown as { __paintLabReady?: boolean })
        .__paintLabReady === true,
  );
  const [live, saved] = await Promise.all([
    readPaintDocumentSnapshot(session),
    readPaintSaveRecord(session),
  ]);
  if (!saved)
    throw new Error("Paint verification failed. No saved draft exists.");
  assertMatchingPaintDocuments(live, saved.document);
  await validatePaintImageData(session, saved.document);
}

export async function retainPaintArtifacts(
  session: BrowserSession,
  workspacePath: string,
) {
  const saved = await readPaintSaveRecord(session);
  if (!saved) return null;
  await validatePaintImageData(session, saved.document);
  const directory = join(workspacePath, "artwork");
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.draft-${randomUUID()}`);
  const projectPath = join(directory, "draft.sketch.json"),
    imagePath = join(directory, "draft.png");
  try {
    await writeFile(`${temporary}.json`, JSON.stringify(saved, null, 2));
    await writeFile(
      `${temporary}.png`,
      Buffer.from(
        saved.document.compositePng.slice("data:image/png;base64,".length),
        "base64",
      ),
    );
    await rename(`${temporary}.json`, projectPath);
    await rename(`${temporary}.png`, imagePath);
  } finally {
    await Promise.all([
      rm(`${temporary}.json`, { force: true }),
      rm(`${temporary}.png`, { force: true }),
    ]);
  }
  return { projectPath, imagePath };
}
