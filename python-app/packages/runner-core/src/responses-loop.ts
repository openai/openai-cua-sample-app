import OpenAI from "openai";

import { type BrowserSession } from "@cua-sample/browser-runtime";

import { RunnerCoreError } from "./errors.js";
import type { RunExecutionContext } from "./scenario-runtime.js";

type FunctionCallItem = {
  arguments?: string;
  call_id?: string;
  name?: string;
  status?: string;
  type: "function_call";
};

type PythonCall = {
  call_id: string;
  arguments: string;
  code: string;
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
  session: BrowserSession;
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

function buildCodeToolDefinitions(platform: string) {
  return [
    {
      type: "function",
      name: "exec_py",
      description:
        "Execute Python in the persistent PyAutoGUI desktop session for this run.",
      strict: true,
      parameters: {
        additionalProperties: false,
        properties: {
          code: {
            description: [
              `Python to execute on the local ${platform} desktop. Python globals survive between calls.`,
              "Available globals: pyautogui, log(value), and display(image), accepting a Pillow image.",
              "A visible Chromium window is already open to the lab. Start with display(pyautogui.screenshot()).",
              "Use PyAutoGUI mouse and keyboard input. On macOS (darwin), use command hotkeys; elsewhere use ctrl.",
              "Screenshots use the same coordinates as PyAutoGUI input, including on Retina displays. All coordinates refer to the full desktop screenshot.",
              "Operate only the lab window. No Playwright objects are available. Do not change the PyAutoGUI fail-safe setting.",
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

async function executePythonToolCall(
  input: ResponsesLoopContext,
  functionCall: PythonCall,
) {
  if (!input.session.execution) {
    throw new Error(
      "Python runtime is unavailable. Install runtimes/requirements.txt into .venv and start a new run.",
    );
  }
  const result = await input.session.execution.execute(functionCall.code, input.context.signal);
  for (const item of result.output) {
    if (item.type !== "input_image") continue;
    const base64 = item.image_url.slice("data:image/png;base64,".length);
    const bytes = Buffer.from(base64, "base64");
    const isPng = bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const dimensions = isPng
      ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      : {};
    await input.context.captureScreenshot(input.session, "Code tool image", {
      base64, ...dimensions, source: "code_tool",
    });
  }
  await input.context.syncBrowserState(input.session);
  await input.context.captureScreenshot(
    input.session,
    `responses-code-turn-${Date.now()}`,
  );
  return result.output.length > 0
    ? result.output
    : [{ text: "exec_py completed with no output.", type: "input_text" as const }];
}

async function executeFunctionToolCall(
  input: ResponsesLoopContext,
  functionCall: PythonCall,
) {
  await input.context.emitEvent({
    detail: `exec_py ${functionCall.arguments}`,
    level: "pending",
    message: "Function tool call received from the model.",
    type: "function_call_requested",
  });

  const output = await executePythonToolCall(input, functionCall);

  await input.context.emitEvent({
    detail: "exec_py",
    level: "ok",
    message: "Function tool call completed.",
    type: "function_call_completed",
  });

  return output;
}

function invalidResponse(message: string) {
  return new RunnerCoreError(message, {
    code: "unexpected_model_response",
    statusCode: 400,
  });
}

// Validate every output item before allowing any Python to execute.
function classifyResponse(response: ResponsesApiResponse) {
  if (response.status !== "completed" || response.error) {
    throw invalidResponse(
      `Responses API request did not complete (status: ${response.status ?? "missing"}). ${response.error?.message ?? ""}`.trim(),
    );
  }
  if (!Array.isArray(response.output)) {
    throw invalidResponse("Responses API output is missing.");
  }

  const calls: PythonCall[] = [];
  const callIds = new Set<string>();
  const commentary: string[] = [];
  const final: string[] = [];
  let refusal: string | undefined;

  for (const item of response.output) {
    if (!item || typeof item !== "object") {
      throw invalidResponse("Malformed response output item.");
    }
    if (item.type === "reasoning") continue;

    if (item.type === "function_call") {
      const call = item as FunctionCallItem;
      if (call.name !== "exec_py") {
        throw invalidResponse(`Unexpected function call: ${call.name ?? "<unknown>"}. Only exec_py is supported.`);
      }
      if (call.status !== undefined && call.status !== "completed") {
        throw invalidResponse("The response contains an unfinished function call.");
      }
      if (typeof call.call_id !== "string" || !call.call_id.trim()) {
        throw invalidResponse("Function call ID is missing.");
      }
      if (callIds.has(call.call_id)) {
        throw invalidResponse(`Duplicate function call ID: ${call.call_id}.`);
      }
      if (typeof call.arguments !== "string") {
        throw invalidResponse("Function call arguments must be a JSON string.");
      }
      let args: unknown;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        throw invalidResponse("Function call arguments are not valid JSON.");
      }
      if (
        !args || typeof args !== "object" || Array.isArray(args) ||
        !("code" in args) || typeof args.code !== "string" ||
        Object.keys(args).some((key) => key !== "code")
      ) {
        throw invalidResponse("exec_py requires a code string and no other arguments.");
      }
      if (!args.code.trim() || Buffer.byteLength(args.code) > 64 * 1024) {
        throw invalidResponse("Python code must be nonempty and at most 64 KiB.");
      }
      callIds.add(call.call_id);
      calls.push({ call_id: call.call_id, arguments: call.arguments, code: args.code });
      continue;
    }

    if (item.type !== "message") {
      throw new RunnerCoreError(`Unsupported response output: ${item.type}. Only exec_py tool calls are supported.`, {
        code: "unsupported_tool_response",
        statusCode: 400,
      });
    }
    const message = item as MessageItem;
    if (
      message.role !== "assistant" || !Array.isArray(message.content) ||
      (message.status !== undefined && message.status !== "completed")
    ) {
      throw invalidResponse("The response contains an invalid or unfinished assistant message.");
    }
    if (message.phase != null && message.phase !== "commentary" && message.phase !== "final_answer") {
      throw invalidResponse("Unknown assistant message phase.");
    }
    for (const part of message.content) {
      if (!part || typeof part !== "object") {
        throw invalidResponse("Malformed assistant message content.");
      }
      if (part.type === "refusal") {
        refusal = (typeof part.refusal === "string" && part.refusal.trim()) || "The model declined this task.";
        continue;
      }
      if (part.type !== "output_text" || typeof part.text !== "string") {
        throw invalidResponse("Unsupported assistant message content.");
      }
      if (!part.text.trim()) continue;
      if (message.phase === "commentary") {
        commentary.push(part.text.trim());
      } else {
        // Phase is optional per message, including alongside explicit commentary.
        final.push(part.text.trim());
      }
    }
  }

  if (refusal) {
    throw new RunnerCoreError(refusal, { code: "model_refusal", statusCode: 400 });
  }
  const progress = commentary.join("\n\n");
  if (calls.length) return { kind: "calls" as const, calls, commentary: progress };
  if (final.length) return { kind: "final" as const, text: final.join("\n\n"), commentary: progress };
  if (commentary.length) return { kind: "commentary" as const, commentary: progress };
  throw invalidResponse("Responses API returned no tool calls or nonempty final assistant message.");
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
        tools: buildCodeToolDefinitions(input.session.execution?.platform ?? process.platform),
        truncation: "auto",
      },
      input.context.signal,
    );
    assertActive(input.context.signal);
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
      assertActive(input.context.signal);
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
