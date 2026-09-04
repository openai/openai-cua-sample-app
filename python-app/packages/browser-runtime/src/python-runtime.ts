import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeOutputItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "original" };

export const pythonDesktopCapabilities = { headless: false } as const;

export type PythonRuntime = {
  close: () => Promise<void>;
  execute: (code: string, signal?: AbortSignal) => Promise<{ output: RuntimeOutputItem[] }>;
  platform: string;
};

export class PythonRuntimeError extends Error {
  readonly code: string;

  constructor(error: unknown) {
    const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
    super(typeof detail.message === "string" ? detail.message : String(error));
    this.name = "PythonRuntimeError";
    this.code = typeof detail.code === "string" ? detail.code : "python_operation_failed";
  }
}

type Options = {
  signal?: AbortSignal;
  executionTimeoutMs?: number;
  pythonPath?: string;
  workerPath?: string;
  releaseHelperPath?: string;
  releaseTimeoutMs?: number;
};

type PendingResponse = {
  id: number;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

function releaseInputs(pythonPath: string, helperPath: string, env: NodeJS.ProcessEnv, timeoutMs: number) {
  return new Promise<void>((resolveRelease, reject) => {
    const helper = spawn(pythonPath, ["-I", "-u", helperPath], {
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env,
    });
    let output = "";
    let failure: PythonRuntimeError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      failure = new PythonRuntimeError({ code: "input_release_timeout", message: `Input release exceeded ${timeoutMs}ms.` });
      try {
        if (helper.pid && process.platform !== "win32") process.kill(-helper.pid, "SIGKILL");
        else helper.kill("SIGKILL");
      } catch { /* The exit event may already be queued. */ }
      // Do not wait indefinitely if the operating system cannot reap the helper.
      killTimer = setTimeout(() => finish(new PythonRuntimeError({
        code: "input_release_timeout", message: "Input release timed out and helper exit could not be confirmed.",
      })), 1_000);
    }, timeoutMs);
    function finish(error?: Error) {
      clearTimeout(timer);
      clearTimeout(killTimer);
      helper.stdout.destroy();
      helper.stderr.destroy();
      if (error) reject(error); else resolveRelease();
    }
    helper.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4_000); });
    helper.stderr.on("data", () => undefined);
    helper.once("error", (error) => finish(new PythonRuntimeError({
      code: "input_release_failed", message: `Could not start input release: ${error.message}`,
    })));
    helper.once("close", (code) => {
      if (failure) { finish(failure); return; }
      try {
        const result = JSON.parse(output) as { released?: boolean; error?: string };
        if (code !== 0 || result.released !== true) throw new Error(result.error ?? "Release was not acknowledged.");
        finish();
      } catch (error) {
        finish(new PythonRuntimeError({ code: "input_release_failed", message: `Input release failed: ${error instanceof Error ? error.message : String(error)}` }));
      }
    });
  });
}

function readOutput(result: Record<string, unknown>): RuntimeOutputItem[] {
  if (!Array.isArray(result.output)) throw new Error("Python returned invalid tool output.");
  return result.output.map((item: unknown): RuntimeOutputItem => {
    if (item && typeof item === "object" && "type" in item) {
      if (item.type === "input_text" && "text" in item && typeof item.text === "string") {
        return { type: "input_text", text: item.text };
      }
      if (item.type === "input_image" && "image_url" in item &&
        typeof item.image_url === "string" && item.image_url.startsWith("data:image/png;base64,")) {
        return { type: "input_image", image_url: item.image_url, detail: "original" };
      }
    }
    throw new Error("Python returned an unsupported output item.");
  });
}

export async function launchPythonRuntime(options: Options = {}): Promise<PythonRuntime> {
  if (options.signal?.aborted) throw new Error("Run aborted.");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const venv = resolve(root, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  const pythonPath = options.pythonPath ?? process.env.CUA_PYTHON ?? (existsSync(venv) ? venv : "python3");
  const workerPath = options.workerPath ?? resolve(root, "runtimes/python-worker.py");
  const releaseHelperPath = options.releaseHelperPath ?? resolve(root, "runtimes/release-inputs.py");
  const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "OPENAI_API_KEY"));
  const child = spawn(pythonPath, ["-u", workerPath], {
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnvironment,
  });

  // A descendant can keep inherited pipes open after the worker has exited.
  // Wait for the process itself, then dispose of our pipe handles below.
  const exited = new Promise<void>((resolveExit) => {
    child.once("exit", () => resolveExit());
    child.once("error", () => {
      if (!child.pid) resolveExit(); // A failed spawn has no exit event.
    });
  });
  let closed = false;
  let stopping: Promise<void> | undefined;
  let buffer = Buffer.alloc(0);
  let stderr = "";
  let sequence = 0;
  let pending: PendingResponse | undefined;
  let inputMayBeHeld = false;

  function fail(error: Error) {
    const receiver = pending;
    pending = undefined;
    receiver?.reject(error);
  }

  function terminate() {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", onAbort);
    child.stdin.end();
    if (child.pid) {
      try {
        if (process.platform === "win32") child.kill();
        else process.kill(-child.pid, "SIGKILL");
      } catch { /* Already exited. */ }
    }
    fail(new Error("Python session closed."));
  }

  function close(): Promise<void> {
    return stopping ??= (async () => {
      terminate();
      await exited;
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      // Retain the stdin error handler until any pending write has settled.
      child.stdin.once("close", () => child.stdin.removeAllListeners("error"));
      buffer = Buffer.alloc(0);
      stderr = "";
      if (inputMayBeHeld) {
        await releaseInputs(pythonPath, releaseHelperPath, childEnvironment, options.releaseTimeoutMs ?? 3_000);
      }
    })();
  }

  function onAbort() {
    void close().catch(() => undefined); // The execution/finally path reports cleanup failures.
  }

  options.signal?.addEventListener("abort", onAbort, { once: true });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  child.stdin.on("error", (error) => {
    fail(error);
    void close().catch(() => undefined);
  });
  child.on("error", (error) => {
    fail(new Error(`Could not start local Python: ${error.message}. Install runtimes/requirements.txt into .venv or set CUA_PYTHON.`));
    void close().catch(() => undefined);
  });
  child.on("exit", () => {
    fail(new Error(`Python worker exited. ${stderr}`.trim()));
    void close().catch(() => undefined);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 12 * 1024 * 1024) {
      fail(new Error("Python output exceeds 12 MiB."));
      void close().catch(() => undefined);
      return;
    }
    let newline: number;
    while ((newline = buffer.indexOf(10)) !== -1) {
      const line = buffer.subarray(0, newline).toString("utf8");
      buffer = buffer.subarray(newline + 1);
      const receiver = pending;
      pending = undefined;
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (!receiver || !value || typeof value !== "object") throw new Error("Invalid response.");
        if ("id" in value && value.id !== receiver.id) throw new Error("Unexpected Python response ID.");
        if ("error" in value) receiver.reject(new PythonRuntimeError(value.error));
        else receiver.resolve(value);
      } catch {
        receiver?.reject(new Error("Python worker returned invalid JSON or response ID."));
        void close().catch(() => undefined);
        return;
      }
    }
  });

  function receive(timeoutMs: number, id = 0): Promise<Record<string, unknown>> {
    return new Promise((resolveResponse, reject) => {
      if (closed || stopping) {
        reject(new Error("Python session closed."));
        return;
      }
      if (pending) {
        reject(new Error("A Python operation is already running."));
        return;
      }
      const timer = setTimeout(() => {
        fail(new Error(`Python execution exceeded ${timeoutMs}ms. Start a new run.`));
        void close().catch(() => undefined);
      }, timeoutMs);
      pending = {
        id,
        resolve: (value) => { clearTimeout(timer); resolveResponse(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
    });
  }

  async function request(code: string, signal?: AbortSignal) {
    if (closed || stopping) throw new Error("Python session closed.");
    if (pending) throw new Error("A Python operation is already running.");
    if (signal?.aborted) {
      await close();
      throw new Error("Run aborted.");
    }
    const id = ++sequence;
    if (signal !== options.signal) signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = receive(options.executionTimeoutMs ?? 20_000, id);
      inputMayBeHeld = true;
      child.stdin.write(JSON.stringify({ id, operation: "execute", code }) + "\n");
      const value = await response;
      if (signal?.aborted || options.signal?.aborted) throw new Error("Run aborted.");
      return value;
    } catch (error) {
      await close();
      throw error;
    } finally {
      if (signal !== options.signal) signal?.removeEventListener("abort", onAbort);
    }
  }

  try {
    const ready = await receive(15_000);
    if (ready.ready !== true || typeof ready.platform !== "string") {
      throw new Error("Python desktop did not initialize.");
    }
    return {
      platform: ready.platform,
      close,
      async execute(code, signal) {
        if (closed || stopping) throw new Error("Python session closed.");
        if (typeof code !== "string" || !code.trim() || Buffer.byteLength(code) > 64 * 1024) {
          throw new Error("Python code must be nonempty and at most 64 KiB.");
        }
        try {
          return { output: readOutput(await request(code, signal)) };
        } catch (error) {
          await close();
          throw error;
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
