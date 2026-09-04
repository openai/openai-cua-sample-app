import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { assertPortAvailable, launchConfiguration, requestServiceShutdown, waitForBackend } from "./launch.mjs";

test("launch choice selects exactly one runner and one console identity", () => {
  const js = launchConfiguration("javascript", false, {});
  const py = launchConfiguration("python", true, {});
  assert.equal(js.env.CUA_BACKEND, "javascript");
  assert.equal(js.runnerBaseUrl, "http://127.0.0.1:4001");
  assert.equal(py.env.CUA_BACKEND, "python");
  assert.equal(py.runnerBaseUrl, "http://127.0.0.1:4041");
  assert.deepEqual(py.args, ["-m", "app"]);
  assert.equal(py.consoleCommand, "start");
  assert.throws(() => launchConfiguration("all"), /Choose/);
  assert.throws(() => launchConfiguration("python", false, { PORT: "0" }), /PORT/);
});

test("port preflight reports the occupied address without disturbing its listener", async () => {
  const server = createServer((_request, response) => response.end("existing service"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await assert.rejects(assertPortAvailable("127.0.0.1", port, "Backend"), error => {
      assert.match(error.message, new RegExp(`127\\.0\\.0\\.1:${port} is already in use`));
      assert.match(error.message, /Ctrl\+C.*wait for shutdown.*retry/);
      return true;
    });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "existing service");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("port preflight releases an available port", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assertPortAvailable("127.0.0.1", port, "Console");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise(resolve => server.close(resolve));
});

test("occupied coordination port rejects a launch before its runner starts", async () => {
  const coordination = createServer();
  await new Promise((resolve, reject) => {
    coordination.once("error", reject);
    coordination.listen(4050, "127.0.0.1", resolve);
  });
  const child = spawn(process.execPath, [fileURLToPath(new URL("./launch.mjs", import.meta.url)), "javascript"], {
    env: { ...process.env, OPENAI_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  try {
    const status = await Promise.race([exited, delay(5_000, "timeout", { ref: false })]);
    assert.deepEqual(status, [1, null], stderr);
    assert.match(stderr, /Backend coordination address 127\.0\.0\.1:4050 is already in use/);
    assert.doesNotMatch(stderr, /Runner failed to start|identity mismatch/);
    assert.equal(stdout, "");
    assert.equal(coordination.listening, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    await new Promise(resolve => coordination.close(resolve));
  }
});

test("managed shutdown closes the pipe instead of sending a forceful Windows signal", () => {
  const calls = [];
  const child = { stdin: { end: () => calls.push("eof") }, kill: signal => calls.push(signal) };
  requestServiceShutdown(child, true);
  assert.deepEqual(calls, ["eof"]);
});

test("managed JavaScript backend exits gracefully when its launcher closes stdin", async () => {
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const config = launchConfiguration("javascript", false, {
    ...process.env, PORT: String(port), HOST: "127.0.0.1", RUNNER_BASE_URL: `http://127.0.0.1:${port}`,
    CUA_MANAGED_LAUNCH: "1", OPENAI_API_KEY: "",
  });
  const child = spawn(config.command, config.args, { env: config.env, stdio: ["pipe", "ignore", "pipe"] });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  try {
    await waitForBackend(config.runnerBaseUrl, "javascript", { isAlive: () => child.exitCode === null && child.signalCode === null });
    requestServiceShutdown(child, true);
    const status = await Promise.race([exited, delay(5_000, "timeout", { ref: false })]);
    assert.deepEqual(status, [0, null], stderr);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  }
});

test("readiness refuses a different running backend or dead child", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ backendId: "javascript" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(waitForBackend(url, "python"), /identity mismatch/);
    await assert.rejects(waitForBackend(url, "javascript", { instanceId: "new-launch" }), /earlier launch/);
    await assert.rejects(waitForBackend(url, "javascript", { isAlive: () => false }), /exited/);
    assert.equal((await waitForBackend(url, "javascript")).backendId, "javascript");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
