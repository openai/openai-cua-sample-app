import vm from "node:vm";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "@cua-sample/browser-runtime";
import type { PaintDocumentSnapshot, PaintSaveRecord } from "@cua-sample/replay-schema";
import { getScenarioById, paintDefaultPrompt } from "@cua-sample/scenario-kit";

import type { RunExecutionContext } from "../src/scenario-runtime.js";
import { createPaintExecutor } from "../src/scenarios/paint.js";
import { assertPaintOutcome, retainPaintArtifacts } from "../src/paint-plan.js";

const mocks = vi.hoisted(() => ({
  createResponse: vi.fn(),
  launchJavaScriptSession: vi.fn(),
  closeLab: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    responses = { create: mocks.createResponse };
  },
}));
vi.mock("@cua-sample/browser-runtime", () => ({
  launchJavaScriptSession: mocks.launchJavaScriptSession,
}));
vi.mock("../src/workspace-lab-server.js", () => ({
  startWorkspaceLabServer: async () => ({
    close: mocks.closeLab,
    urlFor: () => "http://127.0.0.1:3103/index.html",
  }),
}));

const directories: string[] = [];
const imageBytes = Buffer.from("saved artwork fixture");
const png = `data:image/png;base64,${imageBytes.toString("base64")}`;
const draw = "await page.mouse.click(512, 384);";
const save = 'await page.getByRole("button", { name: "Save draft" }).click();';

function snapshot(paintedPixelCount = 0): PaintDocumentSnapshot {
  const hash = String(paintedPixelCount).repeat(64);
  return {
    version: 2,
    name: "Artwork",
    width: 1024,
    height: 768,
    layers: [{ id: "layer-1", name: "Layer 1", visible: true, opacity: 1, png, pixelHash: hash }],
    compositePng: png,
    compositePixelHash: hash,
    paintedPixelCount,
  };
}

async function setup(verificationEnabled: boolean, code: string) {
  const workspacePath = await mkdtemp(join(tmpdir(), "paint-executor-"));
  directories.push(workspacePath);
  let live = snapshot();
  let saved: PaintSaveRecord | null = null;
  const saveDraft = vi.fn(async () => {
    saved = { version: 2, savedAt: "2026-09-03T00:00:00.000Z", document: structuredClone(live) };
  });
  vi.stubGlobal("__paintLabReady", true);
  vi.stubGlobal("__paintReadDocumentSnapshot", async () => structuredClone(live));
  vi.stubGlobal("__paintReadSaveRecord", () => structuredClone(saved));
  const session = {
    browser: {},
    context: {},
    mode: "headless",
    targetLabel: "Sketch Studio",
    viewport: { width: 1440, height: 900 },
    execute: vi.fn(async (source: string) => {
      await new vm.Script(`(async () => { ${source} })()`).runInNewContext({ page: session.page });
      return [{ type: "input_text", text: "executed" }];
    }),
    finalizeScenario: vi.fn(async (input: { verificationEnabled: boolean }) => {
      const artifacts = await retainPaintArtifacts(session as never, workspacePath);
      if (input.verificationEnabled) await assertPaintOutcome(session as never);
      return {
        verificationPassed: input.verificationEnabled,
        verificationDetail: "Saved artwork verified.",
        ...(artifacts ? { artifacts } : {}),
        notes: artifacts ? [`Saved artwork: ${artifacts.imagePath}`, `Layered project: ${artifacts.projectPath}`] : ["No draft was saved; no paint artifacts were retained."],
      };
    }),
    close: vi.fn(async () => undefined),
    readState: async () => ({ currentUrl: "http://127.0.0.1:3103/index.html" }),
    page: {
      url: () => "http://127.0.0.1:3103/index.html",
      mouse: {
        click: vi.fn(async () => { live = snapshot(live.paintedPixelCount + 1); }),
      },
      getByRole: vi.fn((role: string, options: { name: string }) => {
        expect(role).toBe("button");
        expect(options.name).toBe("Save draft");
        return { click: saveDraft };
      }),
      waitForFunction: vi.fn(async (predicate: () => boolean) => {
        expect(predicate()).toBe(true);
      }),
      evaluate: vi.fn(async (program: string | (() => unknown)) => {
        // Real Canvas PNG decoding is covered by the browser and paint-plan checks.
        return typeof program === "string" ? { valid: true } : program();
      }),
    },
  };
  mocks.launchJavaScriptSession.mockResolvedValue(session as unknown as BrowserSession);
  mocks.createResponse
    .mockResolvedValueOnce({
      status: "completed",
      id: "paint-response-1",
      output: [{ type: "function_call", name: "exec_js", call_id: "paint-script", arguments: JSON.stringify({ code }) }],
    })
    .mockResolvedValueOnce({
      status: "completed",
      id: "paint-response-2",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Finished the artwork." }] }],
    });
  const context: RunExecutionContext = {
    captureScreenshot: vi.fn(async (_session, label) => ({
      capturedAt: "2026-09-03T00:00:00.000Z",
      id: label,
      label,
      mimeType: "image/png" as const,
      pageUrl: session.page.url(),
      path: join(workspacePath, "screenshots", `${label}.png`),
      url: `/api/runs/paint-test/artifacts/screenshots/${label}.png`,
    })),
    completeRun: vi.fn(async () => undefined),
    emitEvent: vi.fn(async () => undefined),
    syncBrowserState: vi.fn(async () => undefined),
    screenshotDirectory: join(workspacePath, "screenshots"),
    signal: new AbortController().signal,
    stepDelayMs: 0,
    detail: {
      eventStreamUrl: "/api/runs/paint-test/events",
      events: [],
      replayUrl: "/api/runs/paint-test/replay",
      run: {
        id: "paint-test", scenarioId: "paint-draw-poster", labId: "paint",
        browserMode: "headless", model: "gpt-5.6-sol", maxResponseTurns: 24,
        prompt: paintDefaultPrompt, startedAt: "2026-09-03T00:00:00.000Z",
        status: "running", verificationEnabled,
      },
      scenario: getScenarioById("paint-draw-poster")!,
      workspacePath,
    },
  };
  return { context, session, workspacePath, saved: () => saved };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CUA_RESPONSES_MODE", "live");
  vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("paint executor integration", () => {
  it("uses exec_js and retains the completed UI save when verification is disabled", async () => {
    const { context, session, workspacePath, saved } = await setup(false, `${draw} ${save}`);
    await createPaintExecutor().execute(context);

    const [request] = mocks.createResponse.mock.calls[0]!;
    expect(request.tools).toEqual([expect.objectContaining({ name: "exec_js", type: "function" })]);
    expect(request.instructions).toContain("Playwright");
    expect(request.instructions).not.toContain("exec_py");
    expect(request.model).toBe("gpt-5.6-sol");
    expect(session.page.mouse.click).toHaveBeenCalledWith(512, 384);
    const imagePath = join(workspacePath, "artwork", "draft.png");
    const projectPath = join(workspacePath, "artwork", "draft.sketch.json");
    expect(await readFile(imagePath)).toEqual(imageBytes);
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual(saved());
    expect(context.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      verificationPassed: false,
      outcome: "success",
      notes: expect.arrayContaining([`Saved artwork: ${imagePath}`, `Layered project: ${projectPath}`]),
    }));
    expect(context.emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "run_progress", detail: `PNG: ${imagePath} · Project: ${projectPath}`,
    }));
    expect(session.page.waitForFunction).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(mocks.closeLab).toHaveBeenCalledOnce();
  });

  it("verifies matching saved artwork through the normal scenario flow", async () => {
    const { context } = await setup(true, `${draw} ${save}`);
    await createPaintExecutor().execute(context);
    expect(context.completeRun).toHaveBeenCalledWith(expect.objectContaining({ verificationPassed: true }));
  });

  it.each([
    ["stale", `${draw} ${save} ${draw}`, "does not match"],
    ["blank", save, "blank"],
  ])("retains the last saved draft before rejecting %s artwork", async (_label, code, message) => {
    const { context, session, workspacePath, saved } = await setup(true, code);
    await expect(createPaintExecutor().execute(context)).rejects.toThrow(message);
    expect(JSON.parse(await readFile(join(workspacePath, "artwork", "draft.sketch.json"), "utf8"))).toEqual(saved());
    expect(context.completeRun).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(mocks.closeLab).toHaveBeenCalledOnce();
  });

  it.each([false, true])("creates no artwork without a save (verification %s)", async (verificationEnabled) => {
    const { context, workspacePath } = await setup(verificationEnabled, draw);
    if (verificationEnabled) {
      await expect(createPaintExecutor().execute(context)).rejects.toThrow("No saved draft");
    } else {
      await createPaintExecutor().execute(context);
      expect(context.completeRun).toHaveBeenCalledWith(expect.objectContaining({
        notes: expect.arrayContaining(["No draft was saved; no paint artifacts were retained."]),
      }));
    }
    expect(await readdir(workspacePath)).toEqual([]);
  });

  it("propagates artifact write failures and closes the browser without reporting success", async () => {
    const { context, session, workspacePath } = await setup(false, `${draw} ${save}`);
    await writeFile(join(workspacePath, "artwork"), "not a directory");
    await expect(createPaintExecutor().execute(context)).rejects.toThrow();
    expect(context.completeRun).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(mocks.closeLab).toHaveBeenCalledOnce();
  });
});
