import OpenAI from "openai";

import { type JavaScriptSession } from "@cua-sample/browser-runtime";

import { RunnerCoreError } from "./errors.js";
import type { RunExecutionContext } from "./scenario-runtime.js";

type FunctionCallItem = {
  arguments?: string;
  call_id?: string;
  name?: string;
  status?: string;
  type: "function_call";
};

type MessageItem = {
  content?: Array<{
    text?: string;
    refusal?: string;
    type?: string;
  }>;
  role?: string;
  status?: string;
  phase?: string | null;
  type: "message";
};

type ResponseOutputItem =
  | FunctionCallItem
  | MessageItem
  | { [key: string]: unknown; type: string };

type ResponsesApiResponse = {
  error?: { message?: string } | null;
  id: string;
  output?: ResponseOutputItem[];
  status?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
    total_tokens?: number;
  } | null;
};

type ResponsesLoopMode = "auto" | "fallback" | "live";

type ResponsesClient = {
  create: (
    request: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ResponsesApiResponse>;
};

type ResponsesLoopContext = {
  context: RunExecutionContext;
  instructions: string;
  maxResponseTurns: number;
  prompt?: string;
  session: JavaScriptSession;
};

type ResponsesLoopResult = {
  finalAssistantMessage?: string;
  notes: string[];
};

class OpenAIResponsesClient implements ResponsesClient {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async create(request: Record<string, unknown>, signal: AbortSignal) {
    return (await this.client.responses.create(request, {
      signal,
    })) as ResponsesApiResponse;
  }
}

function assertActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error("Run aborted.");
  }
}

function parseResponsesLoopMode(env: NodeJS.ProcessEnv = process.env): ResponsesLoopMode {
  const raw = env.CUA_RESPONSES_MODE?.trim().toLowerCase();

  if (raw === "live" || raw === "fallback" || raw === "auto") {
    return raw;
  }

  return "auto";
}

function isTestEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "test" || env.VITEST === "true";
}

export function createDefaultResponsesClient(): ResponsesClient | null {
  const mode = parseResponsesLoopMode();
  const apiKey = process.env.OPENAI_API_KEY;

  if (mode === "fallback") {
    return null;
  }

  if (!apiKey) {
    if (mode === "live") {
      throw new RunnerCoreError(
        "CUA_RESPONSES_MODE=live requires OPENAI_API_KEY to be set.",
        {
          code: "missing_api_key",
          hint:
            "Set OPENAI_API_KEY before starting a live CUA run, or switch CUA_RESPONSES_MODE back to auto.",
          statusCode: 400,
        },
      );
    }

    return null;
  }

  if (mode === "auto" && isTestEnvironment()) {
    return null;
  }

  return new OpenAIResponsesClient(apiKey);
}

function describeUsage(response: ResponsesApiResponse) {
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens ?? 0;

  return `${inputTokens} in · ${outputTokens} out · ${reasoningTokens} reasoning`;
}

async function emitModelTurnEvent(
  context: RunExecutionContext,
  response: ResponsesApiResponse,
  turn: number,
) {
  await context.emitEvent({
    detail: `${response.id} · ${describeUsage(response)}`,
    level: "ok",
    message: `Responses API turn ${turn} completed.`,
    type: "run_progress",
  });
}

function buildCodeToolDefinitions() {
  return [
    {
      type: "function",
      name: "exec_js",
      description:
        "Execute provided interactive JavaScript in a persistent Playwright REPL context.",
      strict: true,
      parameters: {
        additionalProperties: false,
        properties: {
          code: {
            description: [
              "JavaScript to execute in an async Playwright REPL.",
              "Persist state across calls with globalThis.",
              "Available globals: console.log, display(base64Image), Buffer, browser, context, page.",
              "Prefer locator-based waits and domcontentloaded load-state waits over fixed delays.",
            ].join("\n"),
            type: "string",
          },
        },
        required: ["code"],
        type: "object",
      },
    },
  ];
}

async function executeJavaScriptToolCall(input: ResponsesLoopContext, functionCall: FunctionCallItem) {
  const { code } = JSON.parse(functionCall.arguments!) as { code: string };
  if (!code.trim()) return [{ type: "input_text" as const, text: "No code was provided to exec_js." }];
  const output = await input.session.execute(code, input.context.signal);
  await input.context.syncBrowserState(input.session);
  await input.context.captureScreenshot(input.session, `responses-code-turn-${Date.now()}`);
  return output;
}

async function executeFunctionToolCall(
  input: ResponsesLoopContext,
  functionCall: FunctionCallItem,
) {
  const toolName = functionCall.name ?? "<unknown>";

  await input.context.emitEvent({
    detail: `${toolName} ${functionCall.arguments ?? "{}"}`,
    level: "pending",
    message: "Function tool call received from the model.",
    type: "function_call_requested",
  });

  const output =
    toolName === "exec_js"
      ? await executeJavaScriptToolCall(input, functionCall)
      : (() => {
          throw new Error(
            `Unexpected function call: ${functionCall.name ?? "<unknown>"}.`,
          );
        })();

  await input.context.emitEvent({
    detail: toolName,
    level: "ok",
    message: "Function tool call completed.",
    type: "function_call_completed",
  });

  return output;
}

function invalidResponse(message: string) {
  return new RunnerCoreError(message, { code: "unexpected_model_response", statusCode: 400 });
}

export function classifyResponse(response: ResponsesApiResponse) {
  if (response.status !== "completed" || response.error) {
    throw invalidResponse(`Responses API response ${response.id} has status "${response.status ?? "missing"}"${response.error?.message ? `: ${response.error.message}` : "."}`);
  }
  if (!Array.isArray(response.output)) throw invalidResponse("Responses API output is missing.");
  const calls: FunctionCallItem[] = [];
  const callIds = new Set<string>();
  const commentary: string[] = [];
  const final: string[] = [];
  let refusal: string | undefined;
  for (const item of response.output) {
    if (!item || typeof item !== "object") throw invalidResponse("Malformed response output item.");
    if (item.type === "reasoning") continue;
    if (item.type === "function_call") {
      const call = item as FunctionCallItem;
      if (call.name !== "exec_js" ||
        typeof call.call_id !== "string" || !call.call_id.trim() || callIds.has(call.call_id) ||
        (call.status !== undefined && call.status !== "completed")) {
        throw invalidResponse("Invalid, incomplete, or unsupported function call.");
      }
      let args: unknown;
      try {
        args = JSON.parse(call.arguments ?? "");
      } catch {
        throw invalidResponse("Function call arguments are not valid JSON.");
      }
      if (!args || typeof args !== "object" || Array.isArray(args) ||
        !("code" in args) || typeof args.code !== "string" ||
        Object.keys(args).some(key => key !== "code")) {
        throw invalidResponse("exec_js requires a code string and no other arguments.");
      }
      callIds.add(call.call_id);
      calls.push(call);
      continue;
    }
    if (item.type !== "message") throw invalidResponse(`Unsupported response item: ${item.type}.`);
    const message = item as MessageItem;
    if (message.role !== "assistant" || !Array.isArray(message.content) ||
      (message.status !== undefined && message.status !== "completed")) {
      throw invalidResponse("The response contains an invalid or unfinished assistant message.");
    }
    if (message.phase != null) {
      if (message.phase !== "commentary" && message.phase !== "final_answer") throw invalidResponse("Unknown assistant message phase.");
    }
    for (const part of message.content) {
      if (part.type === "refusal") {
        refusal = part.refusal?.trim() || "The model declined this task.";
        continue;
      }
      if (part.type !== "output_text" || !part.text?.trim()) continue;
      if (message.phase === "commentary") {
        commentary.push(part.text.trim());
      } else {
        // Phase is optional per message, including alongside explicit commentary.
        final.push(part.text.trim());
      }
    }
  }
  if (refusal) throw new RunnerCoreError(refusal, { code: "model_refusal", statusCode: 400 });
  const progress = commentary.join("\n\n");
  // Validate the complete response before dispatching any of its calls.
  if (calls.length) return { kind: "calls" as const, calls, commentary: progress };
  if (final.length) return { kind: "final" as const, text: final.join("\n\n"), commentary: progress };
  if (commentary.length) return { kind: "commentary" as const, commentary: progress };
  throw invalidResponse("Response contains no supported tool calls, progress, or final answer.");
}

export async function runResponsesCodeLoop(
  input: ResponsesLoopContext,
  client: ResponsesClient,
): Promise<ResponsesLoopResult> {
  let previousResponseId: string | undefined;
  let nextInput: unknown = input.prompt ?? input.context.detail.run.prompt;
  let finalAssistantMessage: string | undefined;

  for (let turn = 1; turn <= input.maxResponseTurns; turn += 1) {
    assertActive(input.context.signal);
    const response = await client.create(
      {
        instructions: input.instructions,
        input: nextInput,
        model: input.context.detail.run.model,
        parallel_tool_calls: false,
        previous_response_id: previousResponseId,
        reasoning: { effort: "low" },
        tools: buildCodeToolDefinitions(),
        truncation: "auto",
      },
      input.context.signal,
    );
    const classified = classifyResponse(response);
    await emitModelTurnEvent(input.context, response, turn);

    previousResponseId = response.id;
    if (classified.commentary) {
      await input.context.emitEvent({
        type: "run_progress",
        level: "pending",
        message: "Model progress.",
        detail: classified.commentary,
      });
    }
    if (classified.kind === "final") {
      finalAssistantMessage = classified.text;
      break;
    }
    if (classified.kind === "commentary") {
      nextInput = [];
      continue;
    }
    const functionCalls = classified.calls;

    const toolOutputs = [];

    for (const functionCall of functionCalls) {
      if (!functionCall.call_id) {
        throw new Error("Unexpected function call returned from the model.");
      }

      const output = await executeFunctionToolCall(input, functionCall);

      toolOutputs.push({
        call_id: functionCall.call_id,
        output,
        type: "function_call_output",
      });
    }

    nextInput = toolOutputs;
  }

  if (!finalAssistantMessage) {
    throw new Error(
      `Responses API code loop exhausted the configured ${input.maxResponseTurns}-turn budget without producing a final assistant message.`,
    );
  }

  await input.context.emitEvent({
    detail: finalAssistantMessage,
    level: "ok",
    message: "Model returned a final response.",
    type: "run_progress",
  });

  return {
    finalAssistantMessage,
    notes: [
      "Executed the scenario through a live Responses API code loop.",
      `Model final response: ${finalAssistantMessage}`,
    ],
  };
}
