import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright";

import {
  defaultViewport,
  type BrowserObservationSession,
  type BrowserScreenshot,
  type BrowserSessionState,
  type BrowserSessionOptions,
} from "./session.js";
import {
  isRecord,
  maxCodeBytes,
  maxOutputBytes,
  parseJavaScriptOutput,
  type JavaScriptOutput,
  type WorkerOperation,
} from "./protocol.js";

class JavaScriptRuntimeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "JavaScriptRuntimeError";
  }
}

export type JavaScriptSession = BrowserObservationSession & {
  execute: (code: string, signal?: AbortSignal) => Promise<JavaScriptOutput[]>;
};

type Options = BrowserSessionOptions & {
  workerPath: string;
  signal?: AbortSignal;
  executionTimeoutMs?: number;
};

function parseState(value: unknown): BrowserSessionState {
  if (!isRecord(value) || typeof value.currentUrl !== "string" ||
    (value.pageTitle !== undefined && typeof value.pageTitle !== "string")) {
    throw new Error("JavaScript worker returned invalid browser state.");
  }
  return value as BrowserSessionState;
}

function parseScreenshot(value: unknown): BrowserScreenshot {
  parseState(value);
  if (!isRecord(value) || value.mimeType !== "image/png" ||
    !["id", "label", "path", "capturedAt"].every(key => typeof value[key] === "string")) {
    throw new Error("JavaScript worker returned an invalid screenshot.");
  }
  return value as BrowserScreenshot;
}

const aborted = () => new JavaScriptRuntimeError("Run aborted.", "run_aborted");

export async function launchJavaScriptSession(options: Options): Promise<JavaScriptSession> {
  if (options.signal?.aborted) throw aborted();
  const childEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      name.toUpperCase() !== "OPENAI_API_KEY",
    ),
  );
  // The parent retains a browser handle even if model code blocks the worker.
  const browserServer = await chromium.launchServer({
    host: "127.0.0.1",
    headless: options.browserMode === "headless",
    args: [`--window-size=${defaultViewport.width},${defaultViewport.height}`],
    timeout: 15_000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    env: childEnvironment,
  });
  if (options.signal?.aborted) {
    await browserServer.kill();
    throw aborted();
  }
  let child: ReturnType<typeof fork>;
  try {
    child = fork(options.workerPath, [], {
      // Do not inherit the runner's --env-file arguments.
      execArgv: options.workerPath.endsWith(".ts")
        ? ["--import", createRequire(import.meta.url).resolve("tsx")]
        : [],
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
  } catch (error) {
    await browserServer.kill();
    throw error;
  }
  const exited = new Promise<void>(resolve => {
    child.once("exit", () => resolve());
    child.once("error", () => {
      // A failed spawn has no process and may never emit an exit event.
      if (child.pid === undefined) resolve();
    });
  });
  let closed = false;
  let closing: Promise<void> | undefined;
  let terminalError: Error | undefined;
  let sequence = 0;
  let stderr = "";
  let pending: {
    id: number;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  } | undefined;

  const close = (
    reason: Error = new JavaScriptRuntimeError("JavaScript session closed.", "javascript_session_closed"),
    force = false,
  ): Promise<void> => {
    if (closing) return closing;
    closed = true;
    terminalError = reason;
    options.signal?.removeEventListener("abort", onAbort);
    const receiver = pending;
    pending = undefined;
    closing = (async () => {
      try {
        if (!force && child.connected) {
          child.send({ id: -1, operation: "close" }, () => undefined);
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            exited,
            new Promise<void>(resolve => { timer = setTimeout(resolve, 250); }),
          ]);
          clearTimeout(timer);
        }
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        // Killing the worker does not necessarily kill the Chromium process.
        if (force) {
          await browserServer.kill();
        } else {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              browserServer.close(),
              new Promise<void>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error("Browser close timed out.")), 1_000);
              }),
            ]);
          } catch {
            await browserServer.kill();
          } finally {
            clearTimeout(timer);
          }
        }
        await exited;
      } finally {
        // Descendants can inherit these pipes. Their lifetime must not hold up
        // worker cleanup; this session does not provide process-tree isolation.
        child.stdout?.destroy();
        child.stderr?.destroy();
        receiver?.reject(reason);
      }
    })();
    return closing;
  };
  const fail = (error: Error) => {
    void close(error, true).catch(() => undefined);
  };
  const onAbort = () => fail(aborted());
  options.signal?.addEventListener("abort", onAbort, { once: true });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4_000);
  });
  child.on("error", error => fail(new JavaScriptRuntimeError(
    `JavaScript worker failed: ${error.message}`,
    "javascript_worker_crashed",
  )));
  child.on("exit", () => {
    if (!closed) {
      fail(new JavaScriptRuntimeError(`JavaScript worker exited unexpectedly. ${stderr}`.trim(), "javascript_worker_crashed"));
    }
  });
  child.on("message", (message: unknown) => {
    if (closed) return;
    if (!isRecord(message) || !pending || message.id !== pending.id || Buffer.byteLength(JSON.stringify(message)) > maxOutputBytes) {
      fail(new JavaScriptRuntimeError("JavaScript worker returned an invalid response or request ID.", "javascript_worker_protocol_error"));
      return;
    }
    if (typeof message.error === "string") {
      fail(new JavaScriptRuntimeError(message.error, "javascript_worker_error"));
      return;
    }
    if (!("result" in message)) {
      fail(new JavaScriptRuntimeError("JavaScript worker response is missing its result.", "javascript_worker_protocol_error"));
      return;
    }
    pending.resolve(message.result);
  });

  async function request<T>(
    operation: WorkerOperation,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
    timeoutMs = options.executionTimeoutMs ?? 60_000,
  ): Promise<T> {
    if (closed) throw terminalError ?? new Error("JavaScript session closed.");
    if (pending) throw new Error("A JavaScript operation is already running.");
    if (signal?.aborted || options.signal?.aborted) {
      await close(aborted(), true);
      throw aborted();
    }
    const id = ++sequence;
    if (signal !== options.signal) signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await new Promise<T>((resolve, reject) => {
        // This watchdog runs in the HTTP/API process, before any code is sent.
        const timer = setTimeout(() => fail(new JavaScriptRuntimeError(
          `JavaScript execution exceeded ${timeoutMs}ms. Start a new run.`,
          "javascript_execution_timeout",
        )), timeoutMs);
        pending = {
          id,
          resolve: value => {
            try {
              const parsed = parse(value);
              clearTimeout(timer);
              pending = undefined;
              resolve(parsed);
            } catch (error) {
              fail(new JavaScriptRuntimeError(error instanceof Error ? error.message : String(error), "javascript_worker_protocol_error"));
            }
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          },
        };
        child.send({ id, ...operation }, error => {
          if (error) fail(new JavaScriptRuntimeError(error.message, "javascript_worker_crashed"));
        });
      });
    } finally {
      if (signal !== options.signal) signal?.removeEventListener("abort", onAbort);
    }
  }

  try {
    await request({
      operation: "initialize",
      endpoint: browserServer.wsEndpoint(),
      url: options.url,
      targetLabel: options.targetLabel,
      browserMode: options.browserMode,
      screenshotDir: options.screenshotDir,
    }, parseState, options.signal, 15_000);
    return {
      mode: options.browserMode,
      viewport: defaultViewport,
      targetLabel: options.targetLabel,
      close: () => close(),
      readState: () => request({ operation: "inspect" }, parseState),
      captureScreenshot: label => request({ operation: "capture", label }, parseScreenshot),
      execute: (code, signal) => {
        if (typeof code !== "string" || !code.trim() || Buffer.byteLength(code) > maxCodeBytes) {
          return Promise.reject(new Error("JavaScript code must be nonempty and at most 64 KiB."));
        }
        return request({ operation: "execute", code }, parseJavaScriptOutput, signal);
      },
    };
  } catch (error) {
    await close(error instanceof Error ? error : new Error(String(error)), true);
    throw error;
  }
}
