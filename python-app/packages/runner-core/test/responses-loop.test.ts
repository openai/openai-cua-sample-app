import { afterEach, describe, expect, it, vi } from "vitest";
import { PythonRuntimeError } from "@cua-sample/browser-runtime";

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
    execution: {
      platform: "darwin",
      execute: vi.fn(async () => ({
        output: [
          { type: "input_text" as const, text: "Fixture updated." },
          { type: "input_image" as const, detail: "original" as const, image_url: "data:image/png;base64,cG5n" },
        ],
      })),
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
      detail: {
        run: {
          model: "gpt-5.4",
          prompt: "Finish the browser task and report success.",
        },
      },
      emitEvent: async (input: { detail?: string; message: string; type: string }) => {
        events.push(input);
      },
      signal: new AbortController().signal,
      syncBrowserState: async () => undefined,
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
  it("stops the model loop after the desktop fail-safe is activated", async () => {
    const session = createMockSession();
    const { context } = createMockExecutionContext();
    session.execution.execute.mockRejectedValueOnce(new PythonRuntimeError({
      code: "python_failsafe", message: "Desktop fail-safe activated.",
    }));
    const create = vi.fn(async () => ({ status: "completed", id: "failsafe-response", output: [{
      type: "function_call" as const, name: "exec_py", call_id: "failsafe-call",
      arguments: JSON.stringify({ code: "pyautogui.click()" }),
    }] }));
    await expect(runResponsesCodeLoop({
      context: context as never, instructions: "Use exec_py.", maxResponseTurns: 4, session: session as never,
    }, { create })).rejects.toMatchObject({ code: "python_failsafe" });
    expect(create).toHaveBeenCalledOnce();
    expect(session.execution.execute).toHaveBeenCalledOnce();
    expect(context.captureScreenshot).not.toHaveBeenCalled();
  });

  it("rejects a computer-tool response without executing Python", async () => {
    const session = createMockSession();
    const { context } = createMockExecutionContext();
    await expect(runResponsesCodeLoop({
      context: context as never,
      instructions: "Use exec_py.",
      maxResponseTurns: 1,
      session: session as never,
    }, {
      create: async () => ({ status: "completed", id: "unsupported", output: [{
        type: "computer_call", call_id: "old-call", actions: [{ type: "click", x: 10, y: 20 }],
      }] }),
    })).rejects.toMatchObject({ code: "unsupported_tool_response" });
    expect(session.execution.execute).not.toHaveBeenCalled();
  });

  it("executes the public exec_py tool path and returns the final assistant message", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      async create(request: Record<string, unknown>) {
        requests.push(request);

        if (requests.length === 1) {
          return { status: "completed",
            id: "resp_code_1",
            output: [
              {
                arguments: JSON.stringify({
                  code: 'log("Fixture updated.")',
                }),
                call_id: "call_exec",
                name: "exec_py",
                type: "function_call" as const,
              },
            ],
          };
        }

        return { status: "completed",
          id: "resp_code_2",
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
        instructions: "Use exec_py to update the fixture, then summarize.",
        maxResponseTurns: 8,
        session: session as never,
      },
      client,
    );

    expect(
      (requests[0]?.tools as Array<{ name?: string }>).map((tool) => tool.name),
    ).toEqual(["exec_py"]);
    expect(session.execution.execute).toHaveBeenCalledWith(
      'log("Fixture updated.")',
      context.signal,
    );
    expect(requests[1]?.input).toEqual([{
      call_id: "call_exec",
      output: [
        { type: "input_text", text: "Fixture updated." },
        { type: "input_image", detail: "original", image_url: "data:image/png;base64,cG5n" },
      ],
      type: "function_call_output",
    }]);
    expect(result.finalAssistantMessage).toBe(
      "Fixture matches the requested final state.",
    );
    expect(
      events.some((event) => event.type === "function_call_completed"),
    ).toBe(true);
  });

  it("rejects the removed JavaScript tool without executing code", async () => {
    const session = createMockSession();
    const { context } = createMockExecutionContext();
    const client = {
      async create() {
        return { status: "completed",
          id: "resp_old_tool",
          output: [{
            arguments: JSON.stringify({ code: "console.log('old tool')" }),
            call_id: "call_old_tool",
            name: "exec_js",
            type: "function_call" as const,
          }],
        };
      },
    };

    await expect(runResponsesCodeLoop({
      context: context as never,
      instructions: "Use exec_py.",
      maxResponseTurns: 1,
      session: session as never,
    }, client)).rejects.toThrow("Unexpected function call: exec_js.");
    expect(session.execution.execute).not.toHaveBeenCalled();
  });
});

const finalMessage = (text: string, phase?: string | null) => ({
  type: "message" as const,
  role: "assistant",
  phase,
  content: [{ type: "output_text", text }],
});
const pythonCall = {
  type: "function_call" as const,
  name: "exec_py",
  call_id: "python-call",
  arguments: JSON.stringify({ code: 'log("Fixture updated.")' }),
};

describe("response completion", () => {
  function setup(maxResponseTurns = 3) {
    const session = createMockSession();
    const { context, events } = createMockExecutionContext();
    return {
      events, session,
      input: { context: context as never, instructions: "Use exec_py.", maxResponseTurns, session: session as never },
    };
  }

  it.each(["failed", "incomplete", "cancelled", "queued", "in_progress", "unknown"])(
    "rejects status %s even when output includes a final answer and Python", async (status) => {
      const { input, session } = setup();
      const create = vi.fn(async () => ({ id: "not-complete", status, output: [finalMessage("Done."), pythonCall] }));
      await expect(runResponsesCodeLoop(input, { create })).rejects.toThrow(`status: ${status}`);
      expect(create).toHaveBeenCalledTimes(1);
      expect(session.execution.execute).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, "final_answer"])("accepts a nonempty final answer with phase %s", async (phase) => {
    const { input } = setup();
    await expect(runResponsesCodeLoop(input, {
      create: async () => ({ id: "final", status: "completed", output: [finalMessage("Done.", phase)] }),
    })).resolves.toMatchObject({ finalAssistantMessage: "Done." });
  });

  it("continues commentary and returns Python results before accepting the final answer", async () => {
    const { input, session } = setup();
    const create = vi.fn()
      .mockResolvedValueOnce({ status: "completed", id: "commentary", output: [finalMessage("I will update the fixture.", "commentary")] })
      .mockResolvedValueOnce({ status: "completed", id: "tools", output: [pythonCall, finalMessage("Premature final.", "final_answer")] })
      .mockResolvedValueOnce({ status: "completed", id: "final", output: [finalMessage("Fixture updated.", "final_answer")] });
    await expect(runResponsesCodeLoop(input, { create })).resolves.toMatchObject({ finalAssistantMessage: "Fixture updated." });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ previous_response_id: "commentary", input: [] });
    expect(create.mock.calls[2]?.[0]).toMatchObject({ previous_response_id: "tools", input: [{
      type: "function_call_output", call_id: "python-call", output: expect.any(Array),
    }] });
    expect(session.execution.execute).toHaveBeenCalledTimes(1);
  });

  it.each(["computer_call", "custom_tool_call", "web_search_call"])("rejects unsupported %s alongside a final answer", async (type) => {
    const { input } = setup();
    await expect(runResponsesCodeLoop(input, {
      create: async () => ({ status: "completed", id: "unsupported", output: [{ type }, finalMessage("Done.")] }),
    })).rejects.toMatchObject({ code: "unsupported_tool_response" });
  });

  it.each(["commentary", "tools"])("fails when %s consumes the turn budget", async (kind) => {
    const { input, events } = setup(2);
    const create = vi.fn(async () => ({ status: "completed", id: "continue", output: kind === "tools" ? [pythonCall] : [finalMessage("Still working.", "commentary")] }));
    await expect(runResponsesCodeLoop(input, { create })).rejects.toThrow("exhausted the configured 2-turn budget");
    expect(create).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.message === "Model returned a final response.")).toBe(false);
  });

  it("rejects an empty final answer", async () => {
    const { input } = setup();
    await expect(runResponsesCodeLoop(input, {
      create: async () => ({ status: "completed", id: "empty", output: [finalMessage("  ")] }),
    })).rejects.toThrow("no tool calls or nonempty final assistant message");
  });

  it.each(["Python execution timed out.", "Python worker exited.", "Run aborted."])("keeps execution failure terminal: %s", async (message) => {
    const { input, session } = setup();
    session.execution.execute.mockRejectedValueOnce(new Error(message));
    const create = vi.fn(async () => ({ status: "completed", id: "tools", output: [pythonCall] }));
    await expect(runResponsesCodeLoop(input, { create })).rejects.toThrow(message);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects missing response status", async () => {
    const { input, session } = setup();
    await expect(runResponsesCodeLoop(input, {
      create: async () => ({ id: "missing", output: [pythonCall] }),
    })).rejects.toThrow("status: missing");
    expect(session.execution.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["unfinished call", { ...pythonCall, call_id: "second", status: "in_progress" }],
    ["unfinished message", { ...finalMessage("Done."), status: "incomplete" }],
    ["unsupported tool", { ...pythonCall, call_id: "second", name: "exec_js" }],
    ["missing call ID", { ...pythonCall, call_id: "" }],
    ["duplicate call ID", pythonCall],
    ["malformed JSON", { ...pythonCall, call_id: "second", arguments: "{" }],
    ["extra arguments", { ...pythonCall, call_id: "second", arguments: '{"code":"print(1)","shell":true}' }],
    ["empty code", { ...pythonCall, call_id: "second", arguments: '{"code":" "}' }],
    ["non-string code", { ...pythonCall, call_id: "second", arguments: '{"code":5}' }],
    ["null arguments", { ...pythonCall, call_id: "second", arguments: "null" }],
    ["array arguments", { ...pythonCall, call_id: "second", arguments: "[]" }],
    ["unknown phase", finalMessage("Done.", "unexpected")],
    ["refusal", { ...finalMessage(""), content: [{ type: "refusal", refusal: "Cannot do this." }] }],
  ])("rejects a late %s before any Python executes", async (_label, invalidItem) => {
    const { input, session } = setup();
    await expect(runResponsesCodeLoop(input, {
      create: async () => ({ id: "invalid", status: "completed", output: [pythonCall, invalidItem] as never }),
    })).rejects.toThrow();
    expect(session.execution.execute).not.toHaveBeenCalled();
  });

  it("accepts an unphased final alongside commentary", async () => {
    const { input } = setup();
    await expect(runResponsesCodeLoop(input, {
      create: async () => ({ id: "final", status: "completed", output: [
        finalMessage("Finishing.", "commentary"), finalMessage("Done."),
      ] }),
    })).resolves.toMatchObject({ finalAssistantMessage: "Done." });
  });

  it("does not execute tools when cancellation arrives during a model request", async () => {
    const { input, session } = setup();
    const controller = new AbortController();
    input.context = { ...input.context as object, signal: controller.signal } as never;
    await expect(runResponsesCodeLoop(input, { create: async () => {
      controller.abort();
      return { status: "completed", id: "late", output: [pythonCall] };
    } })).rejects.toThrow("Run aborted.");
    expect(session.execution.execute).not.toHaveBeenCalled();
  });
});
