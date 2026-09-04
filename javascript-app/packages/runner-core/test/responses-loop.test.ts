import { afterEach, describe, expect, it, vi } from "vitest";

import { RunnerCoreError } from "../src/errors.js";
import {
  createDefaultResponsesClient,
  runResponsesCodeLoop,
  classifyResponse,
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
    execute: vi.fn()
      .mockResolvedValueOnce([{ text: "Fixture updated.", type: "input_text" }, { detail: "original", image_url: "data:image/png;base64,cG5n", type: "input_image" }])
      .mockResolvedValueOnce([{ text: "updated -> verified", type: "input_text" }, { detail: "original", image_url: "data:image/png;base64,cG5n", type: "input_image" }]),
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
      detail: {
        run: {
          model: "gpt-5.6-sol",
          prompt: "Finish the browser task and report success.",
        },
      },
      emitEvent: async (input: { detail?: string; message: string; type: string }) => {
        events.push(input);
      },
      signal: new AbortController().signal,
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
  it("chains worker outputs, images, and replay artifacts", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      async create(request: Record<string, unknown>) {
        requests.push(request);

        if (requests.length === 1) {
          return {
            status: "completed",
            id: "resp_code_1",
            output: [
              {
                arguments: JSON.stringify({
                  code: [
                    'globalThis.completedSteps = ["updated"];',
                    'console.log("Fixture updated.");',
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
            status: "completed",
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
          status: "completed",
          id: "resp_code_3",
          output: [
            {
              content: [
                {
                  text: "Fixture matches the requested final state.",
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
        instructions: "Use exec_js to update the fixture, then summarize.",
        maxResponseTurns: 8,
        session: session as never,
      },
      client,
    );

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
          { text: "Fixture updated.", type: "input_text" },
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
      "Fixture matches the requested final state.",
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


describe("response completion", () => {
  const text = (phase?: string) => ({ type: "message", role: "assistant", ...(phase ? { phase } : {}), content: [{ type: "output_text", text: "Working." }] });
  const response = (output: unknown[], status = "completed") => ({ id: "response", status, output }) as never;

  it.each(["incomplete", "cancelled", "failed", "in_progress", "queued"])("rejects %s before any tool dispatch", status => {
    expect(() => classifyResponse(response([text("final_answer")], status))).toThrow(/status/);
  });
  it("accepts completed final answers with optional phases", () => {
    expect(classifyResponse(response([text()]))).toMatchObject({ kind: "final", text: "Working." });
    expect(classifyResponse(response([text("final_answer")]))).toMatchObject({ kind: "final" });
    expect(classifyResponse(response([text("commentary")]))).toMatchObject({ kind: "commentary" });
  });
  it.each([undefined, null])("accepts an unphased final answer alongside explicit commentary (phase %s)", async phase => {
    const { context, events } = createMockExecutionContext();
    const client = {
      create: vi.fn().mockResolvedValue(response([
        text("commentary"),
        {
          type: "message",
          role: "assistant",
          phase,
          content: [{ type: "output_text", text: "Finished." }],
        },
      ])),
    };
    await expect(runResponsesCodeLoop({
      context: context as never,
      session: createMockSession() as never,
      instructions: "test",
      maxResponseTurns: 1,
    }, client)).resolves.toMatchObject({ finalAssistantMessage: "Finished." });
    expect(client.create).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({ message: "Model progress.", detail: "Working." }));
  });
  it.each([
    [{ type: "computer_call", call_id: "computer" }],
    [{ type: "function_call", name: "exec_py", call_id: "python", arguments: '{"code":"pass"}' }],
    [{ type: "function_call", name: "exec_js", call_id: "js", arguments: '{"code":1}' }],
    [{ type: "message", role: "assistant", status: "in_progress", content: [{ type: "output_text", text: "unfinished" }] }],
    [],
  ])("rejects malformed or unsupported output %j", (...output) => {
    expect(() => classifyResponse(response(output))).toThrow();
  });
  it("rejects duplicate calls and terminal refusals", () => {
    const call = { type: "function_call", name: "exec_js", call_id: "same", arguments: '{"code":"console.log(1)"}' };
    expect(() => classifyResponse(response([call, call]))).toThrow();
    expect(() => classifyResponse(response([call, { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "No." }] }]))).toThrow("No.");
  });
  it("continues commentary through previous_response_id before accepting a final answer", async () => {
    const { context } = createMockExecutionContext();
    const client = { create: vi.fn().mockResolvedValueOnce(response([text("commentary")])).mockResolvedValueOnce(response([text("final_answer")])) };
    await expect(runResponsesCodeLoop({ context: context as never, session: createMockSession() as never, instructions: "test", maxResponseTurns: 2 }, client)).resolves.toMatchObject({ finalAssistantMessage: "Working." });
    expect(client.create.mock.calls[1]![0]).toMatchObject({ previous_response_id: "response", input: [] });
  });
  it("validates every call before executing the first", async () => {
    const { context } = createMockExecutionContext();
    const session = createMockSession();
    const client = { create: vi.fn().mockResolvedValue(response([
      { type: "function_call", name: "exec_js", call_id: "ok", arguments: '{"code":"console.log(1)"}' },
      { type: "computer_call", call_id: "unsupported" },
    ])) };
    await expect(runResponsesCodeLoop({ context: context as never, session: session as never, instructions: "test", maxResponseTurns: 1 }, client)).rejects.toThrow();
    expect(session.execute).not.toHaveBeenCalled();
  });
});
