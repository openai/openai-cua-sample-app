import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, get, request, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import type { RunDetail, RunEvent, StartRunResponse } from "@cua-sample/replay-schema";

const expectedExecutionTimeoutMs = 60_000;

type OwnedProcess = { kind: "worker" | "browser"; pid: number };

function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

async function stopRunner(child: ChildProcess, owned: OwnedProcess[]) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  // Bound cleanup even when testing a regression that breaks graceful shutdown.
  for (const { pid } of owned) {
    if (isAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ } }
  }
}

function jsonRequest<T = unknown>(url: string, method = "GET", body?: unknown, timeoutMs = 3_000) {
  return new Promise<{ status: number; body: T }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(url, {
      method,
      ...(payload ? { headers: { "content-type": "application/json" } } : {}),
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP ${method} ${url} timed out.`)));
    req.end(payload);
  });
}

function openEvents(url: string) {
  const events: RunEvent[] = [];
  let response: IncomingMessage | undefined;
  let buffer = "";
  let close = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    const req = get(url, { headers: { origin: "http://127.0.0.1:3000" } }, (incoming) => {
      req.setTimeout(0);
      response = incoming;
      if (incoming.statusCode !== 200) { reject(new Error(`SSE returned ${incoming.statusCode}`)); return; }
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => {
        buffer += chunk;
        let separator: number;
        while ((separator = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
        }
      });
      incoming.on("error", reject);
      resolve();
    });
    req.on("error", reject);
    req.setTimeout(3_000, () => req.destroy(new Error("SSE response headers timed out.")));
    close = () => { response?.destroy(); req.destroy(); };
  });
  return { events, ready, close: () => close() };
}

describe("worker cancellation over HTTP", () => {
  it.each([
    ["synchronous loop after an await", "await Promise.resolve(); while (true) {}", false],
    ["pending promise", "await new Promise(() => {});", false],
    ["pending browser operation", 'await page.waitForSelector("#never-added", { timeout: 0 });', false],
    [`${expectedExecutionTimeoutMs / 1000}-second deadline expiry`, "while (true) {}", true],
  ] as const)("keeps health and SSE responsive during a %s and awaits owned process exit", async (_name, code, deadline) => {
    const dataRoot = await mkdtemp(join(tmpdir(), "cua-worker-http-"));
    let entered = false;
    let responseCount = 0;
    let mockAddress = "";
    const mockApi = createServer(async (req, res) => {
      if (req.url === "/entered") {
        entered = true;
        res.end("ready");
        return;
      }
      if (req.url !== "/v1/responses") { res.writeHead(404).end(); return; }
      for await (const chunk of req) { void chunk; }
      responseCount += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: `mock-response-${responseCount}`, status: "completed",
        output: responseCount === 1 ? [{
          type: "function_call", name: "exec_js", call_id: "blocking-code",
          arguments: JSON.stringify({ code: `await page.request.get(${JSON.stringify(`${mockAddress}/entered`)}); ${code}` }),
        }] : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }],
      }));
    });
    await new Promise<void>((resolve) => mockApi.listen(0, "127.0.0.1", resolve));
    const mockPort = mockApi.address();
    if (!mockPort || typeof mockPort === "string") throw new Error("Mock API did not bind.");
    mockAddress = `http://127.0.0.1:${mockPort.port}`;
    const owned: OwnedProcess[] = [];
    let logs = "";
    let child: ChildProcess | undefined;
    let events: ReturnType<typeof openEvents> | undefined;
    try {
      child = fork(fileURLToPath(new URL("./fixtures/worker-server.ts", import.meta.url)), [], {
        execArgv: ["--import", createRequire(new URL("../../../../javascript-app/package.json", import.meta.url)).resolve("tsx")],
        env: { ...process.env, CUA_TEST_DATA_ROOT: dataRoot, CUA_RESPONSES_MODE: "live", OPENAI_API_KEY: "integration-test-key", OPENAI_BASE_URL: `${mockAddress}/v1` },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      child.stdout?.on("data", () => undefined);
      child.stderr?.on("data", (chunk: Buffer) => { logs = (logs + chunk.toString()).slice(-8_000); });
      let address = "";
      child.on("message", (message: unknown) => {
        const value = message as { type?: string; address?: string; kind?: OwnedProcess["kind"]; pid?: number };
        if (value.type === "ready") address = value.address ?? "";
        if (value.type === "owned-process" && value.kind && value.pid) owned.push({ kind: value.kind, pid: value.pid });
      });
      await vi.waitFor(() => expect(address, logs).not.toBe(""), { timeout: 10_000, interval: 50 });
      const input = { scenarioId: "kanban-reprioritize-sprint", prompt: "Open the board.", browserMode: "headless", verificationEnabled: false };
      const started = await jsonRequest<StartRunResponse>(`${address}/api/runs`, "POST", input);
      expect(started.status).toBe(202);
      const runId = started.body.runId;
      events = openEvents(`${address}/api/runs/${runId}/events`);
      await events.ready;
      await vi.waitFor(() => expect(entered, logs).toBe(true), { timeout: 15_000, interval: 50 });
      await vi.waitFor(() => expect(events!.events.some((event) => event.type === "function_call_requested")).toBe(true));
      await vi.waitFor(() => expect(owned.map((entry) => entry.kind).sort()).toEqual(["browser", "worker"]));
      expect(owned.every(({ pid }) => isAlive(pid))).toBe(true);

      expect((await jsonRequest(`${address}/health`)).status).toBe(200);
      const reconnect = openEvents(`${address}/api/runs/${runId}/events`);
      try {
        await reconnect.ready;
        await vi.waitFor(() => expect(reconnect.events.some((event) => event.type === "function_call_requested")).toBe(true));
      } finally { reconnect.close(); }

      const labUrl = events.events.find((event) => event.type === "lab_started")?.detail as string;
      expect(labUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
      if (deadline) {
        await vi.waitFor(async () => {
          const [health, detail] = await Promise.all([
            jsonRequest(`${address}/health`),
            jsonRequest<RunDetail>(`${address}/api/runs/${runId}`),
          ]);
          expect(health.status).toBe(200);
          expect(detail.body.run.status).toBe("failed");
          expect(detail.body.run.summary?.notes.join("\n")).toContain(`${expectedExecutionTimeoutMs}ms`);
        }, { timeout: expectedExecutionTimeoutMs + 10_000, interval: 100 });
      } else {
        const stopped = await jsonRequest<RunDetail>(`${address}/api/runs/${runId}/stop`, "POST", undefined, 5_000);
        expect(stopped.status).toBe(200);
        expect(stopped.body.run.status).toBe("cancelled");
      }
      expect(owned.map(({ pid }) => isAlive(pid))).toEqual([false, false]);
      await expect(jsonRequest(labUrl)).rejects.toThrow();
      const terminalEvent = deadline ? "run_failed" : "run_cancelled";
      await vi.waitFor(() => expect(events!.events.filter((event) => event.type === terminalEvent)).toHaveLength(1));

      const next = await jsonRequest<StartRunResponse>(`${address}/api/runs`, "POST", input);
      expect(next.status).toBe(202);
      expect(next.body.runId).not.toBe(runId);
      await vi.waitFor(async () => {
        const detail = await jsonRequest<RunDetail>(`${address}/api/runs/${next.body.runId}`);
        expect(detail.body.run.status, JSON.stringify(detail.body.run.summary)).toBe("completed");
      }, { timeout: 15_000, interval: 100 });
      await jsonRequest(`${address}/api/runs/${next.body.runId}/stop`, "POST", undefined, 5_000);
      expect(owned).toHaveLength(4);
      expect(owned.every(({ pid }) => !isAlive(pid))).toBe(true);
      expect(responseCount).toBe(2);
    } finally {
      events?.close();
      if (child) await stopRunner(child, owned);
      mockApi.closeAllConnections();
      await new Promise<void>((resolve) => mockApi.close(() => resolve()));
      await rm(dataRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
