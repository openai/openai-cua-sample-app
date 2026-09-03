import { type BrowserSession } from "@cua-sample/browser-runtime";
import { type PaintGrid } from "@cua-sample/scenario-kit";

export type PaintSaveRecord =
  | {
      checksum: string;
      paintedCellCount: number;
    }
  | null;

function cloneGrid(grid: PaintGrid): PaintGrid {
  return JSON.parse(JSON.stringify(grid)) as PaintGrid;
}

function countPaintedCells(grid: PaintGrid) {
  return grid.flat().filter((cell) => cell !== "blank").length;
}

export function buildPaintRunnerPrompt(prompt: string) {
  return prompt.trim();
}

export function buildPaintCodeInstructions(currentUrl: string) {
  return [
    "You are operating a persistent Playwright browser session for a GPT-5.4 CUA demo harness.",
    "You must use the exec_js tool before you answer.",
    `The paint app is already open at ${currentUrl}.`,
    "Use the operator prompt as the source of truth.",
    "Create a best-effort pixel-art interpretation of the requested image using the available palette, then save the draft.",
    "You can use the Erase swatch to correct mistakes if needed.",
    "Reply briefly once the draft has been saved.",
  ].join("\n");
}

async function readPaintValue<T>(
  session: BrowserSession,
  accessorName: "__paintReadCanvasGrid" | "__paintReadSaveRecord",
) {
  return session.page.evaluate((name) => {
    const scope = globalThis as unknown as Record<string, (() => T) | undefined>;
    const accessor = scope[name];

    if (typeof accessor !== "function") {
      throw new Error(`Paint accessor ${name} is unavailable.`);
    }

    return accessor();
  }, accessorName);
}

export async function readPaintCanvasGrid(session: BrowserSession) {
  return cloneGrid(await readPaintValue<PaintGrid>(session, "__paintReadCanvasGrid"));
}

export async function readPaintSaveRecord(session: BrowserSession) {
  return readPaintValue<PaintSaveRecord>(session, "__paintReadSaveRecord");
}

export async function assertPaintOutcome(session: BrowserSession) {
  await session.page.waitForFunction(() => {
    const scope = globalThis as unknown as {
      __paintLabReady?: boolean;
      __paintReadSaveRecord?: () => PaintSaveRecord;
    };

    return scope.__paintLabReady === true && scope.__paintReadSaveRecord?.() != null;
  });

  const [canvasGrid, saveRecord] = await Promise.all([
    readPaintCanvasGrid(session),
    readPaintSaveRecord(session),
  ]);

  if (!saveRecord) {
    throw new Error(
      "Paint verification failed. Saved artwork record was missing.",
    );
  }

  const currentChecksum = canvasGrid.map((row) => row.join("-")).join("/");

  if (saveRecord.checksum !== currentChecksum) {
    throw new Error(
      [
        "Paint verification failed.",
        "Saved checksum did not match the live canvas checksum.",
        `Observed ${saveRecord.checksum}.`,
        `Live ${currentChecksum}.`,
      ].join(" "),
    );
  }

  const paintedCellCount = countPaintedCells(canvasGrid);

  if (saveRecord.paintedCellCount !== paintedCellCount) {
    throw new Error(
      [
        "Paint verification failed.",
        "Saved painted-cell count did not match the live canvas.",
        `Observed ${saveRecord.paintedCellCount}.`,
        `Live ${paintedCellCount}.`,
      ].join(" "),
    );
  }

  if (paintedCellCount <= 0) {
    throw new Error(
      "Paint verification failed. The saved artwork was blank.",
    );
  }
}
