import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { launchPythonRuntime } from "../src/python-runtime.js";

const venv = fileURLToPath(new URL("../../../.venv/bin/python", import.meta.url));
const options = {
  pythonPath: process.env.CUA_PYTHON ?? (existsSync(venv) ? venv : "python3"),
  workerPath: fileURLToPath(new URL("./fixtures/python-worker.py", import.meta.url)),
  releaseHelperPath: fileURLToPath(new URL("./fixtures/release-inputs.py", import.meta.url)),
};

describe("local Python session", () => {
  it("preserves state and Unicode between calls, then terminates the process", async () => {
    const runtime = await launchPythonRuntime(options);
    const first = await runtime.execute("counter = 41\nprint(os.getpid())");
    const pid = Number(first.output[0]?.type === "input_text" ? first.output[0].text.trim() : "");
    try {
      expect((await runtime.execute("print(counter + 1, 'café 😀')")).output).toEqual([
        { type: "input_text", text: "42 café 😀\n" },
      ]);
    } finally { await runtime.close(); }
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(runtime.execute("print('closed')")).rejects.toThrow("closed");
  });

  it("kills a blocked snippet at the deadline", async () => {
    const runtime = await launchPythonRuntime({ ...options, executionTimeoutMs: 100 });
    await expect(runtime.execute("time.sleep(60)")).rejects.toThrow("exceeded 100ms");
    await runtime.close();
    await expect(runtime.execute("print('late')")).rejects.toThrow("closed");
  });

  it("keeps run cancellation active after a completed snippet", async () => {
    const controller = new AbortController();
    const runtime = await launchPythonRuntime({ ...options, signal: controller.signal });
    await runtime.execute("print('first')", controller.signal);
    const executing = runtime.execute("time.sleep(60)", controller.signal);
    controller.abort();
    await expect(executing).rejects.toThrow("closed");
    await runtime.close();
  });

  it.skipIf(process.platform === "win32")("cleans up descendants when the worker exits unexpectedly", async () => {
    const runtime = await launchPythonRuntime(options);
    let descendantPid: number | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await runtime.execute([
        "import subprocess, sys",
        'descendant = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])',
        "print(descendant.pid)",
      ].join("\n"));
      descendantPid = Number(result.output[0]?.type === "input_text" ? result.output[0].text.trim() : "");
      expect(descendantPid).toBeGreaterThan(0);

      await expect(runtime.execute("os._exit(2)")).rejects.toThrow("Python worker exited");
      await Promise.race([
        runtime.close(),
        new Promise<never>((_, reject) => {
          closeTimer = setTimeout(() => reject(new Error("Descendant kept Python stdio open.")), 1_000);
        }),
      ]);
      await expect.poll(() => {
        try { process.kill(descendantPid!, 0); return true; } catch { return false; }
      }).toBe(false);
    } finally {
      clearTimeout(closeTimer);
      if (descendantPid && Number.isInteger(descendantPid)) {
        try { process.kill(descendantPid, "SIGKILL"); } catch { /* Already reaped. */ }
      }
      await runtime.close();
    }
  });
});

it("kills a blocked worker before releasing input, and shares one teardown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cua-release-order-"));
  const helper = join(directory, "release.py");
  const marker = join(directory, "released.jsonl");
  const runtime = await launchPythonRuntime({ ...options, releaseHelperPath: helper, executionTimeoutMs: 100 });
  try {
    const result = await runtime.execute("print(os.getpid())");
    const pid = Number(result.output[0]?.type === "input_text" ? result.output[0].text.trim() : "");
    await writeFile(helper, [
      "import json, os",
      `try: os.kill(${pid}, 0)`,
      "except ProcessLookupError: pass",
      "else: raise RuntimeError('worker is still alive')",
      `with open(${JSON.stringify(marker)}, 'a') as log: log.write('released\\n')`,
      "print(json.dumps({'released': True}), flush=True)",
    ].join("\n"));
    await expect(runtime.execute("while True: pass")).rejects.toThrow("exceeded 100ms");
    await Promise.all([runtime.close(), runtime.close()]);
    expect(await readFile(marker, "utf8")).toBe("released\n");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each(["failure", "timeout"] as const)("reports release helper %s and closes execution", async (mode) => {
  const directory = await mkdtemp(join(tmpdir(), "cua-release-failure-"));
  const helper = join(directory, "release.py");
  await writeFile(helper, mode === "timeout"
    ? "import time; time.sleep(60)"
    : "import json; print(json.dumps({'error': 'Input permission revoked'})); raise SystemExit(1)");
  const runtime = await launchPythonRuntime({ ...options, releaseHelperPath: helper, releaseTimeoutMs: 100 });
  try {
    await runtime.execute("print('ran')");
    await expect(runtime.close()).rejects.toMatchObject({ code: mode === "timeout" ? "input_release_timeout" : "input_release_failed" });
    await expect(runtime.execute("print('late')")).rejects.toThrow("closed");
  } finally {
    await runtime.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

it("fails startup promptly when Python cannot be spawned", async () => {
  await expect(launchPythonRuntime({ ...options, pythonPath: "/missing-cua-python" }))
    .rejects.toThrow("Could not start local Python");
}, 2_000);

it.skipIf(process.platform === "win32")("Stop finishes when a detached descendant holds the pipes open, then permits a fresh worker", async () => {
  const controller = new AbortController();
  const runtime = await launchPythonRuntime({ ...options, signal: controller.signal });
  let descendantPid: number | undefined;
  try {
    const result = await runtime.execute([
      "import subprocess, sys",
      'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)',
      "print(child.pid)",
    ].join("\n"));
    descendantPid = Number(result.output[0]?.type === "input_text" ? result.output[0].text.trim() : "");
    expect(descendantPid).toBeGreaterThan(0);
    controller.abort();
    controller.abort();
    await Promise.all([runtime.close(), runtime.close()]);
    // This process is outside the worker's group and still holds its inherited pipes.
    expect(() => process.kill(descendantPid!, 0)).not.toThrow();
    await expect(runtime.execute("print('late')")).rejects.toThrow("closed");
    const next = await launchPythonRuntime(options);
    try {
      expect((await next.execute("print('fresh')")).output).toEqual([{ type: "input_text", text: "fresh\n" }]);
    } finally {
      await next.close();
    }
  } finally {
    if (descendantPid) {
      try { process.kill(descendantPid, "SIGKILL"); } catch { /* Already exited. */ }
    }
    await runtime.close();
  }
}, 2_000);
