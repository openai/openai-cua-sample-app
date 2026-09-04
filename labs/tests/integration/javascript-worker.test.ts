import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchJavaScriptSession, type JavaScriptSession } from "../../../javascript-app/src/browser/javascript-process.js";
import { afterEach, describe, expect, it } from "vitest";

import { startWorkspaceLabServer } from "../../../javascript-app/src/workspace-lab-server.js";

const workerPath = fileURLToPath(new URL("../../../javascript-app/src/javascript-worker.ts", import.meta.url));
const paintLabPath = fileURLToPath(new URL("../../paint-lab-template", import.meta.url));
let workspacePath: string | undefined;
let session: JavaScriptSession | undefined;
let lab: Awaited<ReturnType<typeof startWorkspaceLabServer>> | undefined;

async function startPaintSession() {
  workspacePath = await mkdtemp(join(tmpdir(), "javascript-worker-paint-"));
  lab = await startWorkspaceLabServer({ workspacePath: paintLabPath });
  session = await launchJavaScriptSession({
    browserMode: "headless",
    screenshotDir: join(workspacePath, "screenshots"),
    url: lab.urlFor("index.html"),
    targetLabel: "Integration lab",
    workerPath,
  });
  await session.execute(`
    await page.waitForFunction(() => globalThis.__paintLabReady === true);
  `);
  return { session, workspacePath };
}

afterEach(async () => {
  try {
    await session?.close();
  } finally {
    await lab?.close();
    if (workspacePath) await rm(workspacePath, { recursive: true, force: true });
    session = undefined;
    lab = undefined;
    workspacePath = undefined;
  }
});

describe("worker Paint session", () => {
  it.each([true, false])("captures the final drawing without artwork exports (saved: %s)", async saved => {
    const { session, workspacePath } = await startPaintSession();
    const output = await session.execute(`
      await page.mouse.click(512, 384);
      ${saved ? `
        await page.getByTestId("save-poster").click();
        await page.waitForFunction(() => document.querySelector("#save-indicator").textContent.includes("Saved"));
      ` : ""}
      console.log("Paint actions completed.");
    `);
    expect(output).toEqual([{ type: "input_text", text: "Paint actions completed." }]);

    const screenshot = await session.captureScreenshot("paint-final");
    const image = await readFile(screenshot.path);
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(screenshot.label).toBe("paint-final");
    expect(await readdir(workspacePath)).toEqual(["screenshots"]);
    await expect(session.readState()).resolves.toMatchObject({ currentUrl: expect.stringContaining("index.html") });
  }, 20_000);
});
