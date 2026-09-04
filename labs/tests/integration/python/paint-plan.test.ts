import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "@cua-sample/browser-runtime";
import {
  paintDocumentSnapshotSchema,
  type PaintDocumentSnapshot,
  type PaintSaveRecord,
} from "@cua-sample/replay-schema";
import {
  assertMatchingPaintDocuments,
  assertPaintOutcome,
  readPaintDocumentSnapshot,
  readPaintSaveRecord,
  retainPaintArtifacts,
  validatePaintImageData,
} from "../../../../python-app/packages/runner-core/src/paint-plan.js";

const png = "data:image/png;base64,aW1hZ2U=";
const snapshot = (): PaintDocumentSnapshot => ({
  version: 2,
  name: "Artwork",
  width: 1024,
  height: 768,
  layers: [
    {
      id: "drawing",
      name: "Layer 1",
      visible: true,
      opacity: 1,
      png,
      pixelHash: "a".repeat(64),
    },
  ],
  compositePng: png,
  compositePixelHash: "b".repeat(64),
  paintedPixelCount: 200,
});
const record = (): PaintSaveRecord => ({
  version: 2,
  savedAt: "2026-09-03T00:00:00.000Z",
  document: snapshot(),
});
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("paint save verification", () => {
  it("accepts matching nonblank raster documents", () => {
    expect(() =>
      assertMatchingPaintDocuments(snapshot(), snapshot()),
    ).not.toThrow();
  });
  it.each(["pixels", "layer-opacity", "layer-order", "name"])(
    "rejects stale %s changes",
    (change) => {
      const live = snapshot(),
        saved = snapshot();
      if (change === "pixels") live.compositePixelHash = "c".repeat(64);
      if (change === "layer-opacity") live.layers[0]!.opacity = 0.5;
      if (change === "layer-order")
        live.layers.push({ ...live.layers[0]!, id: "second" });
      if (change === "name") live.name = "New name";
      expect(() => assertMatchingPaintDocuments(live, saved)).toThrow(
        "does not match",
      );
    },
  );
  it("rejects a blank visible composite even when layers exist", () => {
    const blank = { ...snapshot(), paintedPixelCount: 0 };
    expect(() => assertMatchingPaintDocuments(blank, blank)).toThrow("blank");
  });
  it("rejects malformed versions, repeated layer IDs, and excessive dimensions", () => {
    expect(
      paintDocumentSnapshotSchema.safeParse({ ...snapshot(), version: 1 })
        .success,
    ).toBe(false);
    expect(
      paintDocumentSnapshotSchema.safeParse({ ...snapshot(), width: 100000 })
        .success,
    ).toBe(false);
    expect(
      paintDocumentSnapshotSchema.safeParse({
        ...snapshot(),
        layers: [snapshot().layers[0], snapshot().layers[0]],
      }).success,
    ).toBe(false);
  });
  it("fails promptly when no draft was saved", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(null);
    const session = {
      page: { evaluate, waitForFunction: vi.fn() },
    } as unknown as BrowserSession;
    await expect(assertPaintOutcome(session)).rejects.toThrow("No saved draft");
  });
  it.each([undefined, "not-a-function"])("reports unavailable accessors for %s", async (accessor) => {
    vi.stubGlobal("__paintReadDocumentSnapshot", accessor);
    vi.stubGlobal("__paintReadSaveRecord", accessor);
    const session = {
      page: { evaluate: (read: () => unknown) => read() },
    } as unknown as BrowserSession;
    await expect(readPaintDocumentSnapshot(session)).rejects.toThrow("document accessor is unavailable");
    await expect(readPaintSaveRecord(session)).rejects.toThrow("save accessor is unavailable");
  });
  it("rejects decoded PNG inconsistencies after matching document metadata", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce({ valid: false, reason: "PNG is inconsistent." });
    const session = {
      page: { evaluate, waitForFunction: vi.fn() },
    } as unknown as BrowserSession;
    await expect(assertPaintOutcome(session)).rejects.toThrow(
      "PNG is inconsistent",
    );
  });
  it("retains the actual PNG and layered project without requiring verification to be enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paint-artifacts-"));
    directories.push(directory);
    const draft = record();
    const session = {
      page: {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(draft)
          .mockResolvedValueOnce({ valid: true }),
      },
    } as unknown as BrowserSession;
    const result = await retainPaintArtifacts(session, directory);
    expect(JSON.parse(await readFile(result!.projectPath, "utf8"))).toEqual(
      draft,
    );
    expect(await readFile(result!.imagePath, "utf8")).toBe("image");
  });
  it("reports actual PNG decode errors with verification context", async () => {
    const decodeError = new Error("The source image cannot be decoded.");
    const session = {
      page: { evaluate: vi.fn().mockRejectedValue(decodeError) },
    } as unknown as BrowserSession;
    await expect(validatePaintImageData(session, snapshot())).rejects.toMatchObject({
      message: "Paint verification failed. Could not validate saved PNG data: The source image cannot be decoded.",
      cause: decodeError,
    });
  });
  it("does not fabricate artifacts when the user never saves", async () => {
    const session = {
      page: { evaluate: vi.fn().mockResolvedValue(null) },
    } as unknown as BrowserSession;
    await expect(
      retainPaintArtifacts(session, "/not-used"),
    ).resolves.toBeNull();
  });
});
