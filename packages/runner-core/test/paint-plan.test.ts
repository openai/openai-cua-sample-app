import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "@cua-sample/browser-runtime";
import {
  paintDocumentSnapshotSchema,
  paintSaveRecordSchema,
  type PaintDocumentSnapshot,
  type PaintSaveRecord,
} from "@cua-sample/replay-schema";
import {
  assertMatchingPaintDocuments,
  assertPaintOutcome,
  buildPaintCodeInstructions,
  readPaintDocumentSnapshot,
  readPaintSaveRecord,
  retainPaintArtifacts,
  validatePaintImageData,
} from "../src/paint-plan.js";

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
  it.each([
    "composite-pixels",
    "painted-count",
    "layer-pixels",
    "layer-opacity",
    "layer-visibility",
    "layer-name",
    "document-name",
  ])("rejects stale %s changes", (change) => {
    const live = snapshot();
    const saved = snapshot();
    if (change === "composite-pixels") live.compositePixelHash = "c".repeat(64);
    if (change === "painted-count") live.paintedPixelCount += 1;
    if (change === "layer-pixels") live.layers[0]!.pixelHash = "c".repeat(64);
    if (change === "layer-opacity") live.layers[0]!.opacity = 0.5;
    if (change === "layer-visibility") live.layers[0]!.visible = false;
    if (change === "layer-name") live.layers[0]!.name = "Renamed layer";
    if (change === "document-name") live.name = "New name";
    expect(() => assertMatchingPaintDocuments(live, saved)).toThrow("does not match");
  });
  it("rejects layer reordering even when the composite pixels are unchanged", () => {
    const saved = snapshot();
    saved.layers.push({ ...saved.layers[0]!, id: "second", name: "Layer 2" });
    const live = { ...saved, layers: [...saved.layers].reverse() };
    expect(() => assertMatchingPaintDocuments(live, saved)).toThrow("does not match");
  });
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
  it("rejects invalid PNG envelopes, hashes, opacity, pixel counts, and save timestamps", () => {
    const invalidSnapshots = [
      { ...snapshot(), compositePng: "data:image/jpeg;base64,aW1hZ2U=" },
      { ...snapshot(), compositePixelHash: "not-a-sha256" },
      { ...snapshot(), paintedPixelCount: 1024 * 768 + 1 },
      { ...snapshot(), layers: [{ ...snapshot().layers[0]!, opacity: 1.1 }] },
      { ...snapshot(), layers: [] },
    ];
    for (const invalid of invalidSnapshots) {
      expect(paintDocumentSnapshotSchema.safeParse(invalid).success).toBe(false);
    }
    expect(paintSaveRecordSchema.safeParse({ ...record(), savedAt: "yesterday" }).success).toBe(false);
  });
  it("rejects malformed live and saved accessor results", async () => {
    const session = {
      page: { evaluate: vi.fn().mockResolvedValue({ version: 1, grid: [] }) },
    } as unknown as BrowserSession;
    await expect(readPaintDocumentSnapshot(session)).rejects.toThrow("live document snapshot is invalid");
    await expect(readPaintSaveRecord(session)).rejects.toThrow("saved draft is invalid");
  });
  it("reports unavailable read-only accessors without invoking page-internal mutations", async () => {
    vi.stubGlobal("__paintReadDocumentSnapshot", undefined);
    vi.stubGlobal("__paintReadSaveRecord", "not-a-function");
    const session = {
      page: { evaluate: (read: () => unknown) => read() },
    } as unknown as BrowserSession;
    await expect(readPaintDocumentSnapshot(session)).rejects.toThrow("document accessor is unavailable");
    await expect(readPaintSaveRecord(session)).rejects.toThrow("save accessor is unavailable");
  });
  it("instructs the Playwright model to draw through visible controls and save in the UI", () => {
    const instructions = buildPaintCodeInstructions("http://127.0.0.1:3103");
    expect(instructions).toContain("exec_js");
    expect(instructions).toContain("page.screenshot()");
    expect(instructions).toContain("page.mouse");
    expect(instructions).toContain("Save draft");
    expect(instructions).toContain("Do not answer until the artwork has been saved");
    expect(instructions).not.toMatch(/exec_py|PyAutoGUI|__paintReplaceGrid|__paintSavePoster/);
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
  it("reports actual PNG decode errors with verification context", async () => {
    const session = {
      page: { evaluate: vi.fn().mockRejectedValue(new Error("The source image cannot be decoded.")) },
    } as unknown as BrowserSession;
    await expect(validatePaintImageData(session, snapshot())).rejects.toThrow(
      "Paint verification failed. Could not validate saved PNG data: The source image cannot be decoded.",
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
    expect(result).not.toBeNull();
    expect(JSON.parse(await readFile(result!.projectPath, "utf8"))).toEqual(
      draft,
    );
    expect(await readFile(result!.imagePath, "utf8")).toBe("image");
    expect((await readdir(join(directory, "artwork"))).sort()).toEqual([
      "draft.png",
      "draft.sketch.json",
    ]);
  });
  it("retains a completed blank save when verification is disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paint-artifacts-"));
    directories.push(directory);
    const draft = record();
    draft.document.paintedPixelCount = 0;
    const session = {
      page: {
        evaluate: vi.fn()
          .mockResolvedValueOnce(draft)
          .mockResolvedValueOnce({ valid: true }),
      },
    } as unknown as BrowserSession;
    const result = await retainPaintArtifacts(session, directory);
    expect(JSON.parse(await readFile(result!.projectPath, "utf8"))).toEqual(draft);
  });
  it.each(["read", "decode"])("propagates capture %s failures without writing artifacts", async (stage) => {
    const directory = await mkdtemp(join(tmpdir(), "paint-artifacts-"));
    directories.push(directory);
    const evaluate = vi.fn();
    if (stage === "decode") evaluate.mockResolvedValueOnce(record());
    evaluate.mockRejectedValueOnce(new Error("Capture failed."));
    const session = { page: { evaluate } } as unknown as BrowserSession;
    await expect(retainPaintArtifacts(session, directory)).rejects.toThrow("Capture failed.");
    expect(await readdir(directory)).toEqual([]);
  });
  it("rejects inconsistent saved images before creating artifact files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paint-artifacts-"));
    directories.push(directory);
    const session = {
      page: { evaluate: vi.fn()
        .mockResolvedValueOnce(record())
        .mockResolvedValueOnce({ valid: false, reason: "Layer hash mismatch." }) },
    } as unknown as BrowserSession;
    await expect(retainPaintArtifacts(session, directory)).rejects.toThrow("Layer hash mismatch");
    expect(await readdir(directory)).toEqual([]);
  });
  it("propagates filesystem capture failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paint-artifacts-"));
    directories.push(directory);
    await writeFile(join(directory, "artwork"), "Existing file");
    const session = {
      page: { evaluate: vi.fn()
        .mockResolvedValueOnce(record())
        .mockResolvedValueOnce({ valid: true }) },
    } as unknown as BrowserSession;
    await expect(retainPaintArtifacts(session, directory)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(directory, "artwork"), "utf8")).toBe("Existing file");
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
