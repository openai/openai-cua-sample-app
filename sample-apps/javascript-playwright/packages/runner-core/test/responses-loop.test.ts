import { afterEach, describe, expect, it, vi } from "vitest";

import { RunnerCoreError } from "../src/errors.js";
import {
  createDefaultResponsesClient,
  runResponsesCodeLoop,
} from "../src/responses-loop.js";

const originalEnv = {
  CUA_RESPONSES_MODE: process.env.CUA_RESPONSES_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  VITEST: process.env.VITEST,
};

function restoreEnvVariable(name: keyof typeof originalEnv) {
  const value = originalEnv[name];

  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

afterEach(() => {
  restoreEnvVariable("CUA_RESPONSES_MODE");
  restoreEnvVariable("OPENAI_API_KEY");
  restoreEnvVariable("VITEST");
});

function createMockSession() {
  return {
    browser: {},
    context: {},
    mode: "headless" as const,
    page: {
      screenshot: async () => Buffer.from("png"),
      title: async () => "Mock Lab",
      url: () => "http://127.0.0.1:3102",
    },
  };
}

function createMockExecutionContext() {
  const events: Array<{ detail?: string; message: string; type: string }> = [];
  const screenshotArtifact = {
    capturedAt: new Date().toISOString(),
    id: "screenshot-1",
    label: "turn-1",
    mimeType: "image/png" as const,
    pageTitle: "Mock Lab",
    pageUrl: "http://127.0.0.1:3102",
    path: "/tmp/mock-lab.png",
    url: "/artifacts/mock-lab.png",
  };

  return {
    context: {
      captureScreenshot: vi.fn(async () => screenshotArtifact),
      completeRun: async () => undefined,
      detail: {
        scenario: {
          supportsCodeEdits: false,
        },
        run: {
          model: "gpt-5.6-sol",
          prompt: "Finish the browser task and report success.",
        },
      },
      emitEvent: async (input: { detail?: string; message: string; type: string }) => {
        events.push(input);
      },
      screenshotDirectory: "/tmp",
      signal: new AbortController().signal,
      stepDelayMs: 0,
      syncBrowserState: vi.fn(async () => undefined),
    },
    events,
  };
}

describe("createDefaultResponsesClient", () => {
  it("returns null in test mode even when an API key exists", () => {
    process.env.CUA_RESPONSES_MODE = "auto";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.VITEST = "true";

    expect(createDefaultResponsesClient()).toBeNull();
  });

  it("throws a structured missing-api-key error when live mode is forced", () => {
    process.env.CUA_RESPONSES_MODE = "live";
    delete process.env.OPENAI_API_KEY;
    process.env.VITEST = "false";

    try {
      createDefaultResponsesClient();
      throw new Error("Expected createDefaultResponsesClient() to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerCoreError);
      expect(error).toMatchObject({
        code: "missing_api_key",
        hint: expect.stringContaining("Set OPENAI_API_KEY"),
        message: "CUA_RESPONSES_MODE=live requires OPENAI_API_KEY to be set.",
      });
    }
  });
});

describe("runResponsesCodeLoop", () => {
  it("chains exec_js outputs while preserving REPL state, images, and replay artifacts", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      async create(request: Record<string, unknown>) {
        requests.push(request);

        if (requests.length === 1) {
          return {
            id: "resp_code_1",
            output: [
              {
                arguments: JSON.stringify({
                  code: [
                    'globalThis.completedSteps = ["updated"];',
                    'console.log("Board updated.");',
                    'display((await page.screenshot()).toString("base64"));',
                  ].join("\n"),
                }),
                call_id: "call_update",
                name: "exec_js",
                type: "function_call" as const,
              },
            ],
          };
        }

        if (requests.length === 2) {
          return {
            id: "resp_code_2",
            output: [
              {
                arguments: JSON.stringify({
                  code: [
                    'globalThis.completedSteps.push("verified");',
                    'console.log(globalThis.completedSteps.join(" -> "));',
                    'display("data:image/png;base64,cG5n");',
                  ].join("\n"),
                }),
                call_id: "call_verify",
                name: "exec_js",
                type: "function_call" as const,
              },
            ],
          };
        }

        return {
          id: "resp_code_3",
          output: [
            {
              content: [
                {
                  text: "Board matches the requested final state.",
                  type: "output_text",
                },
              ],
              role: "assistant",
              type: "message" as const,
            },
          ],
        };
      },
    };
    const { context, events } = createMockExecutionContext();
    const session = createMockSession();

    const result = await runResponsesCodeLoop(
      {
        context: context as never,
        instructions: "Use exec_js to update the live board, then summarize.",
        maxResponseTurns: 8,
        session: session as never,
      },
      client,
    );

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.tools).toEqual([
        expect.objectContaining({ name: "exec_js", type: "function" }),
      ]);
    }
    expect(requests.map((request) => request.previous_response_id)).toEqual([
      undefined,
      "resp_code_1",
      "resp_code_2",
    ]);
    expect(requests[0]?.input).toBe(context.detail.run.prompt);
    expect(requests[1]?.input).toEqual([
      {
        call_id: "call_update",
        output: [
          { text: "Board updated.", type: "input_text" },
          {
            detail: "original",
            image_url: "data:image/png;base64,cG5n",
            type: "input_image",
          },
        ],
        type: "function_call_output",
      },
    ]);
    expect(requests[2]?.input).toEqual([
      {
        call_id: "call_verify",
        output: [
          { text: "updated -> verified", type: "input_text" },
          {
            detail: "original",
            image_url: "data:image/png;base64,cG5n",
            type: "input_image",
          },
        ],
        type: "function_call_output",
      },
    ]);
    expect(result.finalAssistantMessage).toBe(
      "Board matches the requested final state.",
    );
    expect(
      events
        .filter((event) => event.type.startsWith("function_call_"))
        .map((event) => event.type),
    ).toEqual([
      "function_call_requested",
      "function_call_completed",
      "function_call_requested",
      "function_call_completed",
    ]);
    expect(context.syncBrowserState).toHaveBeenCalledTimes(2);
    expect(context.syncBrowserState).toHaveBeenCalledWith(session);
    expect(context.captureScreenshot).toHaveBeenCalledTimes(2);
    expect(context.captureScreenshot).toHaveBeenCalledWith(
      session,
      expect.stringMatching(/^responses-code-turn-/),
    );
  });
});
