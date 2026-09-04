import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { launchBrowserSession, type BrowserSession } from "../support/browser.js";

import { readPaintDocumentSnapshot } from "../support/browser.js";
import { startWorkspaceLabServer } from "../support/browser.js";

const labsPath = fileURLToPath(new URL("../../", import.meta.url));
let server: Awaited<ReturnType<typeof startWorkspaceLabServer>>;
let session: BrowserSession | undefined;

beforeAll(async () => {
  server = await startWorkspaceLabServer({ workspacePath: labsPath });
});

beforeEach(async () => {
  session = await launchBrowserSession({
    url: server.urlFor("paint-lab-template/index.html"),
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
});

async function enterText() {
  const page = session!.page;
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  const box = (await page.locator("#drawing-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3);
  await page.getByRole("textbox", { name: "Artwork text" }).fill("Keep this text");
}

describe("paint browser interactions", () => {
  it.each(["toolbar", "File menu"])(
    "offers Save draft without PNG export and restores artwork saved from the %s",
    async (saveFrom) => {
      const page = session!.page;
      expect(await page.getByRole("button", { name: "Export PNG", exact: true }).count()).toBe(0);
      await page.getByRole("button", { name: "File", exact: true }).click();
      expect(await page.getByRole("menuitem", { name: "Export PNG", exact: true }).count()).toBe(0);
      expect(await page.locator('[data-action="export"]').count()).toBe(0);
      await page.keyboard.press("Escape");

      await page.getByRole("textbox", { name: "Document name", exact: true }).fill("Saved artwork");
      await page.getByRole("textbox", { name: "Document name", exact: true }).press("Tab");
      const box = (await page.locator("#drawing-canvas").boundingBox())!;
      await page.mouse.move(box.x + 40, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 90, { steps: 5 });
      await page.mouse.up();
      await page.locator('[data-action="add-layer"]').click();
      await enterText();
      if (saveFrom === "File menu") {
        await page.getByRole("button", { name: "File", exact: true }).click();
        await page.getByRole("menuitem", { name: /^Save draft/ }).click();
      } else {
        await page.getByRole("button", { name: "Save draft", exact: true }).click();
      }
      await expect.poll(() => page.locator("#save-indicator").textContent()).toBe("Saved draft");
      expect(await page.locator("#text-entry").isVisible()).toBe(false);
      const saved = await readPaintDocumentSnapshot(session!);
      expect(saved.paintedPixelCount).toBeGreaterThan(0);
      expect(saved.layers).toHaveLength(2);
      expect(saved.layers[0]!.pixelHash).not.toBe(saved.layers[1]!.pixelHash);

      // Reload exercises IndexedDB persistence and verifies the restored image hashes.
      await page.reload();
      await page.waitForFunction(() =>
        (globalThis as unknown as { __paintLabReady?: boolean }).__paintLabReady,
      );
      expect(await readPaintDocumentSnapshot(session!)).toEqual(saved);
      expect(await page.getByRole("textbox", { name: "Document name", exact: true }).inputValue())
        .toBe("Saved artwork");
      expect(await page.locator("#save-indicator").textContent()).toBe("Saved draft");
    },
  );

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

  it("passes the document engine browser checks", async () => {
    const page = session!.page;
    await page.goto(server.urlFor("tests/fixtures/paint-engine/index.html"));
    await page.locator("#summary").filter({ hasText: /\d+ \/ \d+ checks passed/ }).waitFor();
    expect(await page.locator('[data-result="fail"]').allTextContents()).toEqual([]);
    expect(await page.locator('[data-result="pass"]').count()).toBeGreaterThan(0);
  });
});
