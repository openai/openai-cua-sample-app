import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { launchBrowserSession, type BrowserSession } from "@cua-sample/browser-runtime";

import { readPaintDocumentSnapshot, readPaintSaveRecord } from "../src/paint-plan.js";
import { startWorkspaceLabServer } from "../src/workspace-lab-server.js";

const labsPath = fileURLToPath(new URL("../../../../labs/", import.meta.url));
let directory: string;
let server: Awaited<ReturnType<typeof startWorkspaceLabServer>>;
let session: BrowserSession | undefined;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "paint-browser-"));
  server = await startWorkspaceLabServer({ workspacePath: labsPath });
});

beforeEach(async () => {
  session = await launchBrowserSession({
    browserMode: "headless",
    screenshotDir: join(directory, "screenshots"),
    startTarget: {
      kind: "remote_url",
      url: server.urlFor("paint-lab-template/index.html"),
    },
    workspacePath: labsPath,
  });
  session.page.setDefaultTimeout(5_000);
  await session.page.waitForFunction(() =>
    (globalThis as unknown as { __paintLabReady?: boolean }).__paintLabReady,
  );
});

afterEach(async () => {
  await session?.close();
  session = undefined;
});

afterAll(async () => {
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function enterText() {
  const page = session!.page;
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  const box = (await page.locator("#drawing-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3);
  await page.getByRole("textbox", { name: "Artwork text" }).fill("Keep this text");
}

describe("paint browser interactions", () => {
  it.each([
    "add-layer",
    "duplicate-layer",
    "layer-up",
    "layer-down",
    "delete-layer",
    "clear",
  ])("preserves pending text in undo history before %s", async (action) => {
    const page = session!.page;
    if (["layer-up", "layer-down", "delete-layer"].includes(action)) {
      await page.locator('[data-action="add-layer"]').click();
      if (action === "layer-up")
        await page.getByRole("button", { name: "Select Layer 1", exact: true }).click();
    }
    await enterText();
    if (action === "clear")
      await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator(`[data-action="${action}"]`).click();
    expect(await page.locator("#text-entry").isVisible()).toBe(false);

    // Undo the layer operation: the committed text must still be present.
    expect(await page.getByRole("button", { name: "Undo", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await readPaintDocumentSnapshot(session!)).paintedPixelCount).toBeGreaterThan(0);
    // The next undo removes the text itself, rather than an earlier edit.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await readPaintDocumentSnapshot(session!)).paintedPixelCount).toBe(0);
  });

  it("commits text to its original layer before dragging another layer", async () => {
    const page = session!.page;
    await page.locator('[data-action="add-layer"]').click();
    const before = await readPaintDocumentSnapshot(session!);
    await enterText();
    await page.locator(".layerRow").nth(1).dragTo(page.locator(".layerRow").nth(0));
    const after = await readPaintDocumentSnapshot(session!);
    expect(after.layers.map((layer) => layer.id)).toEqual(
      [...before.layers].reverse().map((layer) => layer.id),
    );
    expect(after.layers.find((layer) => layer.name === "Layer 2")!.pixelHash)
      .not.toBe(before.layers[1]!.pixelHash);
    expect(after.layers.find((layer) => layer.name === "Layer 1")!.pixelHash)
      .toBe(before.layers[0]!.pixelHash);
    expect(await page.locator("#text-entry").isVisible()).toBe(false);
  });

  it("activates a focused Save button with Space and still supports Space-drag panning", async () => {
    const page = session!.page;
    await page.getByRole("button", { name: "Save draft", exact: true }).focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => Boolean(
      (globalThis as unknown as { __paintReadSaveRecord?: () => unknown }).__paintReadSaveRecord?.(),
    ));
    expect(await readPaintSaveRecord(session!)).not.toBeNull();

    const viewport = page.locator("#canvas-viewport");
    await viewport.focus();
    const before = (await page.locator("#drawing-canvas").boundingBox())!;
    await page.keyboard.down("Space");
    await page.mouse.move(before.x + 100, before.y + 100);
    await page.mouse.down();
    await page.mouse.move(before.x + 140, before.y + 120);
    await page.mouse.up();
    await page.keyboard.up("Space");
    const after = (await page.locator("#drawing-canvas").boundingBox())!;
    expect(after.x - before.x).toBeCloseTo(40, 0);
    expect(after.y - before.y).toBeCloseTo(20, 0);
    expect(await viewport.getAttribute("class")).not.toContain("isHand");
    expect((await readPaintDocumentSnapshot(session!)).paintedPixelCount).toBe(0);
  });
});
