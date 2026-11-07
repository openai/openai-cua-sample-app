import { describe, expect, it, vi } from "vitest";

import { maxCodeBytes } from "../src/browser/protocol.js";
import { classifyResponse, runResponsesCodeLoop } from "../src/responses-loop.js";

function call(code: string, id: string) {
  return { type: "function_call" as const, name: "exec_js", call_id: id, arguments: JSON.stringify({ code }) };
}

function response(codes: string[]) {
  return { id: "synthetic-response", status: "completed", output: codes.map((code, i) => call(code, `synthetic-${i}`)) };
}

function fixture(codes: string[]) {
  const execute = vi.fn(async (code: string) => {
    // Match the existing worker admission limit without launching a browser.
    if (Buffer.byteLength(code) > maxCodeBytes) throw new Error("Worker rejected oversized code.");
    return [{ type: "input_text" as const, text: "Synthetic result." }];
  });
  const context = {
    detail: { run: { prompt: "Synthetic task.", model: "synthetic-model" } },
    signal: new AbortController().signal,
    emitEvent: vi.fn().mockResolvedValue(undefined),
    syncBrowserState: vi.fn().mockResolvedValue(undefined),
    captureScreenshot: vi.fn().mockResolvedValue(undefined),
  };
  const client = {
    create: vi.fn().mockResolvedValueOnce(response(codes)).mockResolvedValueOnce({
      id: "synthetic-final", status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Complete." }] }],
    }),
  };
  const run = () => runResponsesCodeLoop({
    context: context as never, session: { execute } as never,
    instructions: "Synthetic instructions.", maxResponseTurns: 2,
  }, client);
  return { execute, context, client, run };
}

describe("tool code size admission", () => {
  it.each([
    ["ASCII", "x".repeat(maxCodeBytes + 1)],
    ["UTF-8", "é".repeat(maxCodeBytes / 2 + 1)],
    ["supplementary Unicode", "😀".repeat(maxCodeBytes / 4 + 1)],
  ])("rejects oversized %s code before executing any call in its response", async (_label, oversized) => {
    for (const codes of [["console.log('first');", oversized], [oversized], [oversized, "console.log('last');"]]) {
      const f = fixture(codes);
      const error = await f.run().then(() => null, (cause: unknown) => cause);
      expect(f.execute).not.toHaveBeenCalled();
      expect(error).toMatchObject({ code: "unexpected_model_response" });
      expect(f.context.syncBrowserState).not.toHaveBeenCalled();
      expect(f.context.captureScreenshot).not.toHaveBeenCalled();
      expect(f.client.create).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ["ASCII", "x".repeat(maxCodeBytes)],
    ["UTF-8", "é".repeat(maxCodeBytes / 2)],
    ["supplementary Unicode", "😀".repeat(maxCodeBytes / 4)],
    ["mixed", "x".repeat(maxCodeBytes - 4) + "😀"],
  ])("accepts %s code exactly at the existing byte limit without modifying it", async (_label, code) => {
    expect(Buffer.byteLength(code)).toBe(maxCodeBytes);
    expect(classifyResponse(response([code]))).toMatchObject({ kind: "calls" });
    const f = fixture([code]);
    expect(await f.run()).toMatchObject({ finalAssistantMessage: "Complete." });
    expect(f.execute).toHaveBeenCalledWith(code, f.context.signal);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.client.create.mock.calls[1]?.[0]).toMatchObject({
      input: [{ type: "function_call_output", call_id: "synthetic-0", output: [{ type: "input_text", text: "Synthetic result." }] }],
    });
  });

  it.each([["empty", ""], ["whitespace", " \t\n"], ["oversized whitespace", " ".repeat(maxCodeBytes + 1)]])("preserves the existing no-op behavior for %s code", async (_label, code) => {
    const f = fixture([code]);
    expect(await f.run()).toMatchObject({ finalAssistantMessage: "Complete." });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.client.create.mock.calls[1]?.[0]).toMatchObject({
      input: [{ type: "function_call_output", call_id: "synthetic-0", output: [{ type: "input_text", text: "No code was provided to exec_js." }] }],
    });
  });
});
