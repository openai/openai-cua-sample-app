import vm from "node:vm";
import util from "node:util";

import OpenAI from "openai";

import { type BrowserSession } from "@cua-sample/browser-runtime";

import { RunnerCoreError } from "./errors.js";
import type { RunExecutionContext } from "./scenario-runtime.js";

type FunctionCallItem = {
  arguments?: string;
  call_id?: string;
  name?: string;
  type: "function_call";
};

type MessageItem = {
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  role?: string;
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

type ToolOutput =
  | {
      text: string;
      type: "input_text";
    }
  | {
      detail: "original";
      image_url: string;
      type: "input_image";
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

const toolExecutionTimeoutMs = 20_000;

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

function normalizeImageDataUrl(value: string) {
  return value.startsWith("data:image/")
    ? value
    : `data:image/png;base64,${value}`;
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

function extractAssistantMessageText(response: ResponsesApiResponse) {
  return (response.output ?? [])
    .filter((item): item is MessageItem => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
}

function getFunctionCallItems(response: ResponsesApiResponse) {
  return (response.output ?? []).filter(
    (item): item is FunctionCallItem => item.type === "function_call",
  );
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

async function withExecutionTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    throw new Error("Run aborted.");
  }

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`Tool execution exceeded ${timeoutMs}ms.`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Run aborted."));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function executeJavaScriptToolCall(
  input: ResponsesLoopContext,
  functionCall: FunctionCallItem,
  ctx: vm.Context,
) {
  const parsed = JSON.parse(functionCall.arguments ?? "{}") as {
    code?: string;
  };
  const code = parsed.code ?? "";
  const toolOutputs: ToolOutput[] = [];

  const sandbox = ctx as vm.Context & {
    __setToolOutputs?: (outputs: ToolOutput[]) => void;
  };
  sandbox.__setToolOutputs?.(toolOutputs);

  if (code.trim().length === 0) {
    return [
      {
        text: "No code was provided to exec_js.",
        type: "input_text" as const,
      },
    ];
  }

  const wrappedCode = `
(async () => {
${code}
})();
`;

  try {
    const execution = new vm.Script(wrappedCode, {
      filename: "exec_js.js",
    }).runInContext(ctx);
    await withExecutionTimeout(
      Promise.resolve(execution).then(() => undefined),
      toolExecutionTimeoutMs,
      input.context.signal,
    );
  } catch (error) {
    const formatted =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    toolOutputs.push({
      text: formatted.trim(),
      type: "input_text",
    });
  }

  if (toolOutputs.length === 0) {
    toolOutputs.push({
      text: "exec_js completed with no console output.",
      type: "input_text",
    });
  }

  await input.context.syncBrowserState(input.session);
  await input.context.captureScreenshot(
    input.session,
    `responses-code-turn-${Date.now()}`,
  );

  return toolOutputs;
}

async function executeFunctionToolCall(
  input: ResponsesLoopContext,
  functionCall: FunctionCallItem,
  vmContext: vm.Context,
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
      ? await executeJavaScriptToolCall(input, functionCall, vmContext)
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

function ensureResponseSucceeded(response: ResponsesApiResponse) {
  if (response.error?.message) {
    throw new Error(response.error.message);
  }

  if (response.status === "failed") {
    throw new Error("Responses API request failed.");
  }
}

export async function runResponsesCodeLoop(
  input: ResponsesLoopContext,
  client: ResponsesClient,
): Promise<ResponsesLoopResult> {
  const jsOutputRef: { current: ToolOutput[] } = { current: [] };
  const sandbox = {
    Buffer,
    browser: input.session.browser,
    console: {
      log: (...values: unknown[]) => {
        jsOutputRef.current.push({
          text: util.formatWithOptions(
            { getters: false, maxStringLength: 2_000, showHidden: false },
            ...values,
          ),
          type: "input_text",
        });
      },
    },
    context: input.session.context,
    display: (base64Image: string) => {
      jsOutputRef.current.push({
        detail: "original",
        image_url: normalizeImageDataUrl(base64Image),
        type: "input_image",
      });
    },
    page: input.session.page,
    __setToolOutputs(outputs: ToolOutput[]) {
      jsOutputRef.current = outputs;
    },
  };
  const vmContext = vm.createContext(sandbox);
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
    ensureResponseSucceeded(response);
    await emitModelTurnEvent(input.context, response, turn);

    previousResponseId = response.id;
    const functionCalls = getFunctionCallItems(response);

    if (functionCalls.length === 0) {
      finalAssistantMessage = extractAssistantMessageText(response) || undefined;
      break;
    }

    const toolOutputs = [];

    for (const functionCall of functionCalls) {
      if (!functionCall.call_id) {
        throw new Error("Unexpected function call returned from the model.");
      }

      const output = await executeFunctionToolCall(input, functionCall, vmContext);

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
