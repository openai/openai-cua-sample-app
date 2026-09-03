import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import { launchJavaScriptSession, type JavaScriptSession } from "../src/index.js";

const workerPath = fileURLToPath(new URL("../../runner-core/src/javascript-worker.ts", import.meta.url));
const directories: string[] = [];
const sessions: JavaScriptSession[] = [];
const pids: number[] = [];
const originalLaunch = chromium.launchServer.bind(chromium);

function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

async function start(executionTimeoutMs = 2_000, customWorker?: string, startPage = "index.html") {
  const directory = await mkdtemp(join(tmpdir(), "javascript-session-"));
  directories.push(directory);
  await writeFile(join(directory, "index.html"), '<!doctype html><title>Worker lab</title><button onclick="this.textContent=Number(this.textContent)+1">0</button>');
  vi.spyOn(chromium, "launchServer").mockImplementation(async options => {
    const server = await originalLaunch(options);
    pids.push(server.process().pid!);
    return server;
  });
  const session = await launchJavaScriptSession({
    browserMode: "headless",
    screenshotDir: join(directory, "screenshots"),
    workspacePath: directory,
    startTarget: { kind: "workspace_file", path: startPage },
    executionTimeoutMs,
    workerPath: customWorker ?? workerPath,
  });
  sessions.push(session);
  return session;
}

async function rememberWorker(session: JavaScriptSession) {
  const output = await session.execute('console.log(Buffer.constructor("return process")().pid)');
  const pid = Number(output[0]?.type === "input_text" ? output[0].text : "");
  expect(pid).toBeGreaterThan(0);
  pids.push(pid);
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.close()));
  for (const pid of pids.splice(0)) expect(isAlive(pid), `process ${pid} survived cleanup`).toBe(false);
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("persistent JavaScript worker", () => {
  it("preserves the real page, REPL globals and screenshots, then starts fresh", async () => {
    const session = await start();
    await rememberWorker(session);
    await session.execute('globalThis.saved = [1]; await page.getByRole("button").click();');
    const output = await session.execute('saved.push(2); console.log(saved.join(","), await page.getByRole("button").textContent()); display((await page.screenshot()).toString("base64"));');
    expect(output[0]).toEqual({ type: "input_text", text: "1,2 1" });
    expect(output[1]).toMatchObject({ type: "input_image", image_url: expect.stringMatching(/^data:image\/png;base64,/), detail: "original" });
    expect(await session.readState()).toMatchObject({ pageTitle: "Worker lab" });
    expect(await session.captureScreenshot("same page")).toMatchObject({ mimeType: "image/png", label: "same page" });
    await session.close();
    const next = await start();
    expect(await next.execute('console.log(typeof globalThis.saved, await page.getByRole("button").textContent());')).toEqual([{ type: "input_text", text: "undefined 0" }]);
  }, 20_000);

  it("returns syntax/runtime exceptions for correction without losing state", async () => {
    const session = await start();
    expect(await session.execute("let =")).toEqual([expect.objectContaining({ type: "input_text", text: expect.stringMatching(/SyntaxError|Unexpected/) })]);
    expect(await session.execute('globalThis.value=4; throw new Error("try again");')).toEqual([expect.objectContaining({ text: expect.stringContaining("try again") })]);
    expect(await session.execute("console.log(value + 1)")).toEqual([{ type: "input_text", text: "5" }]);
  }, 15_000);

  it.each([
    "while (true) {}",
    "await Promise.resolve(); while (true) {}",
    "await new Promise(() => {});",
    "await page.waitForTimeout(30_000);",
    'await page.getByRole("button", { name: "missing" }).click({ timeout: 0 });',
    "await new Promise(() => { const spin = () => Promise.resolve().then(spin); spin(); });",
  ])("terminates worker and Chromium when code never finishes: %s", async code => {
    const session = await start(300);
    await rememberWorker(session);
    let heartbeat = false;
    const timer = setTimeout(() => { heartbeat = true; }, 50);
    await expect(session.execute(code)).rejects.toMatchObject({ code: "javascript_execution_timeout" });
    clearTimeout(timer);
    expect(heartbeat).toBe(true);
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
    await expect(session.execute("console.log('late')")).rejects.toMatchObject({ code: "javascript_execution_timeout" });
  }, 15_000);

  it.each([
    "while (true) {}",
    "await Promise.resolve(); while (true) {}",
    "await new Promise(() => {})",
    'await page.getByRole("button", { name: "missing" }).click({ timeout: 0 })',
  ])("cancels both unresolved JavaScript and pending Playwright: %s", async code => {
    const session = await start(5_000);
    await rememberWorker(session);
    const controller = new AbortController();
    const execution = session.execute(code, controller.signal);
    const assertion = expect(execution).rejects.toMatchObject({ code: "run_aborted" });
    setTimeout(() => controller.abort(), 100);
    await assertion;
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
    await expect(session.execute("console.log('late')")).rejects.toMatchObject({ code: "run_aborted" });
  }, 15_000);

  it("lets the model correct a missing locator before the hard deadline", async () => {
    const session = await start(20_000);
    await session.execute("globalThis.keep = 7;");
    const output = await session.execute('await page.getByRole("button", { name: "missing" }).click()');
    expect(output).toEqual([expect.objectContaining({ type: "input_text", text: expect.stringContaining("Timeout 10000ms") })]);
    expect(await session.execute("console.log(keep)")).toEqual([{ type: "input_text", text: "7" }]);
  }, 20_000);

  it("finishes cleanup when a descendant keeps the worker's stdio open", async () => {
    const session = await start(300);
    await rememberWorker(session);
    let descendantPid: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await session.execute(`
        const proc = Buffer.constructor("return process")();
        const child = proc.getBuiltinModule("child_process").spawn(
          proc.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          { stdio: "inherit" },
        );
        console.log(child.pid);
      `);
      descendantPid = Number(output[0]?.type === "input_text" ? output[0].text : "");
      expect(descendantPid).toBeGreaterThan(0);

      await expect(Promise.race([
        session.execute("while (true) {}"),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Cleanup waited for descendant stdio.")), 2_000);
        }),
      ])).rejects.toMatchObject({ code: "javascript_execution_timeout" });
      for (const pid of pids) expect(isAlive(pid)).toBe(false);
      // Descendants are outside this cancellation boundary. The test owns its
      // fixture process and must remove it even when the assertion above fails.
      expect(isAlive(descendantPid)).toBe(true);
    } finally {
      clearTimeout(timer);
      if (descendantPid && isAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
    }
  }, 15_000);

  it("treats an unexpected worker exit as terminal and cleans up Chromium", async () => {
    const session = await start();
    await rememberWorker(session);
    await expect(session.execute('Buffer.constructor("return process")().exit(17)')).rejects.toMatchObject({ code: "javascript_worker_crashed" });
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
  }, 15_000);

  it("does not give the worker the runner API key or env-file startup flags", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-secret");
    const session = await start();
    const output = await session.execute('const proc = Buffer.constructor("return process")(); console.log(proc.env.OPENAI_API_KEY === undefined, proc.execArgv.some(arg => arg.includes("env-file")));');
    expect(output).toEqual([{ type: "input_text", text: "true false" }]);
  }, 15_000);

  it("fails closed on a mismatched IPC response ID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "javascript-protocol-"));
    directories.push(directory);
    const fixture = join(directory, "invalid-worker.mjs");
    await writeFile(fixture, 'process.on("message", message => process.send({id: message.id + 1, result: {currentUrl:"about:blank"}}));');
    await expect(start(300, fixture)).rejects.toMatchObject({ code: "javascript_worker_protocol_error" });
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
  }, 15_000);

  it("cleans up Chromium when the initial navigation fails", async () => {
    await expect(start(2_000, undefined, "missing.html")).rejects.toMatchObject({
      code: "javascript_worker_error",
      message: expect.stringContaining("ERR_FILE_NOT_FOUND"),
    });
    expect(pids).toHaveLength(1);
    expect(isAlive(pids[0]!)).toBe(false);
  }, 15_000);
});
