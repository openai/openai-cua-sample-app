import vm from "node:vm";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "../../../javascript-app/src/browser/session.js";
import { getScenarioById } from "../../../javascript-app/src/lab-catalog.js";

import type { RunExecutionContext } from "../../../javascript-app/src/scenario-runtime.js";
import { createDefaultRunExecutor } from "../../../javascript-app/src/executor-registry.js";

const mocks = vi.hoisted(() => ({
  createResponse: vi.fn(),
  launchJavaScriptSession: vi.fn(),
  closeLab: vi.fn(),
}));

vi.mock("../../../javascript-app/src/responses-loop.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../javascript-app/src/responses-loop.js")>(),
  createDefaultResponsesClient: () => ({ create: mocks.createResponse }),
}));
vi.mock("../../../javascript-app/src/browser/javascript-process.js", () => ({
  launchJavaScriptSession: mocks.launchJavaScriptSession,
}));
vi.mock("../../../javascript-app/src/workspace-lab-server.js", () => ({
  startWorkspaceLabServer: async () => ({
    close: mocks.closeLab,
    urlFor: () => "http://127.0.0.1:3103/index.html",
  }),
}));

const directories: string[] = [];
const draw = "await page.mouse.click(512, 384);";
const save = 'await page.getByRole("button", { name: "Save draft" }).click();';

async function setup(code: string, scenarioId = "paint-draw-poster") {
  const workspacePath = await mkdtemp(join(tmpdir(), "paint-executor-"));
  directories.push(workspacePath);
  const saveDraft = vi.fn(async () => undefined);
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
    close: vi.fn(async () => undefined),
    readState: async () => ({ currentUrl: "http://127.0.0.1:3103/index.html" }),
    page: {
      url: () => "http://127.0.0.1:3103/index.html",
      mouse: {
        click: vi.fn(async () => undefined),
      },
      getByRole: vi.fn((role: string, options: { name: string }) => {
        expect(role).toBe("button");
        expect(options.name).toBe("Save draft");
        return { click: saveDraft };
      }),
      waitForFunction: vi.fn(async (predicate: () => boolean) => {
        expect(predicate()).toBe(true);
      }),
      evaluate: vi.fn(async (read: () => unknown) => read()),
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
    detail: {
      eventStreamUrl: "/api/runs/paint-test/events",
      events: [],
      replayUrl: "/api/runs/paint-test/replay",
      run: {
        id: "paint-test", scenarioId, labId: getScenarioById(scenarioId)!.labId,
        browserMode: "headless", model: "gpt-5.6-sol", maxResponseTurns: 24,
        prompt: getScenarioById(scenarioId)!.defaultPrompt, startedAt: "2026-09-03T00:00:00.000Z",
        status: "running",
      },
      scenario: getScenarioById(scenarioId)!,
      workspacePath,
    },
  };
  return { context, session, workspacePath, saveDraft };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request in mocked executor test.")));
  vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("paint executor integration", () => {
  it("uses exec_js to draw and save through the UI", async () => {
    const { context, session, saveDraft } = await setup(`${draw} ${save}`);
    await createDefaultRunExecutor(context.detail).execute(context);

    const [request] = mocks.createResponse.mock.calls[0]!;
    expect(request.tools).toEqual([expect.objectContaining({ name: "exec_js", type: "function" })]);
    expect(request.instructions).toContain("Playwright");
    expect(request.instructions).not.toContain("exec_py");
    expect(request.model).toBe("gpt-5.6-sol");
    expect(session.page.mouse.click).toHaveBeenCalledWith(512, 384);
    expect(saveDraft).toHaveBeenCalledOnce();
  });

  it.each([
    ["saved", `${draw} ${save}`],
    ["unsaved", draw],
    ["changed after saving", `${draw} ${save} ${draw}`],
    ["blank saved", save],
  ])("finishes a %s drawing with screenshots and a trace, without exporting", async (_label, code) => {
    const { context, session, workspacePath } = await setup(code);
    await createDefaultRunExecutor(context.detail).execute(context);

    expect(context.completeRun).toHaveBeenCalledWith({
      notes: [
        "Executed the scenario through a live Responses API code loop.",
        "Model final response: Finished the artwork.",
      ],
    });
    expect(context.captureScreenshot).toHaveBeenLastCalledWith(session, "paint-final");
    expect(context.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "function_call_requested" }));
    expect(context.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "function_call_completed" }));
    expect(JSON.stringify(vi.mocked(context.emitEvent).mock.calls)).not.toMatch(/Saved artwork:|Layered project:|paint artifacts|No draft was saved/);
    expect(session.page.evaluate).not.toHaveBeenCalled();
    expect(session.page.waitForFunction).not.toHaveBeenCalled();
    expect(await readdir(workspacePath)).toEqual([]);
    expect(session.close).toHaveBeenCalledOnce();
    expect(mocks.closeLab).toHaveBeenCalledOnce();
  });

  it.each(["kanban-reprioritize-sprint", "booking-complete-reservation"])(
    "finishes %s with a freeform prompt",
    async (scenarioId) => {
      const { context, session } = await setup(draw, scenarioId);
      context.detail.run.prompt = "Inspect the interface, then finish.";
      await createDefaultRunExecutor(context.detail).execute(context);
      expect(context.completeRun).toHaveBeenCalledOnce();
      expect(context.captureScreenshot).toHaveBeenLastCalledWith(session, `${context.detail.run.labId}-final`);
      expect(session.close).toHaveBeenCalledOnce();
      expect(mocks.closeLab).toHaveBeenCalledOnce();
    },
  );

  it("propagates final screenshot failures and closes the browser without reporting success", async () => {
    const { context, session } = await setup(`${draw} ${save}`);
    const capture = vi.mocked(context.captureScreenshot).getMockImplementation()!;
    vi.mocked(context.captureScreenshot).mockImplementation(async (_session, label) => {
      if (label === "paint-final") throw new Error("Screenshot failed.");
      return capture(_session, label);
    });
    await expect(createDefaultRunExecutor(context.detail).execute(context)).rejects.toThrow("Screenshot failed.");
    expect(context.captureScreenshot).toHaveBeenCalledWith(session, "paint-final");
    expect(context.completeRun).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    expect(mocks.closeLab).toHaveBeenCalledOnce();
  });
});
