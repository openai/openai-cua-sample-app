import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchJavaScriptSession, type JavaScriptSession } from "@cua-sample/browser-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { startWorkspaceLabServer } from "../../../../javascript-app/packages/runner-core/src/workspace-lab-server.js";

const workerPath = fileURLToPath(new URL("../../../../javascript-app/packages/runner-core/src/javascript-worker.ts", import.meta.url));
const paintLabPath = fileURLToPath(new URL("../../../paint-lab-template", import.meta.url));
let workspacePath: string | undefined;
let session: JavaScriptSession | undefined;
let lab: Awaited<ReturnType<typeof startWorkspaceLabServer>> | undefined;

async function startWithSavedBlankDraft() {
  workspacePath = await mkdtemp(join(tmpdir(), "javascript-worker-finalize-"));
  lab = await startWorkspaceLabServer({ workspacePath: paintLabPath });
  session = await launchJavaScriptSession({
    browserMode: "headless",
    screenshotDir: join(workspacePath, "screenshots"),
    workspacePath,
    startTarget: { kind: "remote_url", url: lab.urlFor("index.html") },
    workerPath,
  });
  await session.execute(`
    await page.waitForFunction(() => globalThis.__paintLabReady === true);
    await page.getByTestId("save-poster").click();
    await page.waitForFunction(() => document.querySelector("#save-indicator").textContent.includes("Saved"));
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

describe("worker scenario finalization", () => {
  it("returns retained artwork paths when verification fails", async () => {
    const { session, workspacePath } = await startWithSavedBlankDraft();
    const result = await session.finalizeScenario({
      scenarioId: "paint-draw-poster",
      prompt: "Save the draft.",
      verificationEnabled: true,
    });

    expect(result).toMatchObject({
      verificationPassed: false,
      verificationDetail: expect.stringContaining("blank"),
      artifacts: {
        imagePath: join(workspacePath, "artwork", "draft.png"),
        projectPath: join(workspacePath, "artwork", "draft.sketch.json"),
      },
    });
    const image = await readFile(result.artifacts!.imagePath);
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(JSON.parse(await readFile(result.artifacts!.projectPath, "utf8"))).toMatchObject({
      version: 2,
      document: { paintedPixelCount: 0 },
    });
    await expect(session.readState()).resolves.toMatchObject({ currentUrl: expect.stringContaining("index.html") });
  }, 20_000);

  it("keeps artifact filesystem failures fatal", async () => {
    const { session, workspacePath } = await startWithSavedBlankDraft();
    await writeFile(join(workspacePath, "artwork"), "not a directory");

    await expect(session.finalizeScenario({
      scenarioId: "paint-draw-poster",
      prompt: "Save the draft.",
      verificationEnabled: true,
    })).rejects.toMatchObject({ code: "javascript_worker_error" });
    await expect(session.readState()).rejects.toMatchObject({ code: "javascript_worker_error" });
  }, 20_000);
});
