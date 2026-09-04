import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { get } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  runDetailSchema,
  runnerErrorResponseSchema,
  scenarioResetResponseSchema,
  scenariosResponseSchema,
  startRunResponseSchema,
  type RunEvent,
} from "@cua-sample/contracts";

import { RunnerCoreError } from "../src/errors.js";
import { RunnerManager } from "../src/runner-manager.js";
import { listScenarios } from "../src/lab-catalog.js";

import { createServer } from "../src/server.js";

vi.mock("../src/executor-registry.js", () => ({
  createDefaultRunExecutor: () => { throw new Error("Generic HTTP tests must supply an executor."); },
}));

const fixture = vi.hoisted(() => ({ workspaceTemplatePath: "" }));
vi.mock("../src/lab-catalog.js", () => {
  const scenario = () => ({
    id: "fixture-scenario", labId: "paint", category: "creativity", title: "Fixture",
    description: "Synthetic HTTP test", defaultPrompt: "Complete fixture.",
    workspaceTemplatePath: fixture.workspaceTemplatePath,
    tags: ["fixture"],
  });
  return { listScenarios: () => [scenario()], getScenarioById: (id: string) => id === "fixture-scenario" ? scenario() : undefined };
});
beforeAll(async () => {
  fixture.workspaceTemplatePath = await mkdtemp(join(tmpdir(), "cua-http-template-"));
  await writeFile(join(fixture.workspaceTemplatePath, "index.html"), "<!doctype html><title>Fixture</title>");
});
afterAll(() => rm(fixture.workspaceTemplatePath, { recursive: true, force: true }));

describe("runner server", () => {
  it.each([false, true])("rejects removed verificationEnabled=%s before starting a run", async verificationEnabled => {
    const startRun = vi.fn();
    const app = createServer({ manager: { startRun, shutdown: async () => undefined } as unknown as RunnerManager });
    try {
      const response = await app.inject({ method: "POST", url: "/api/runs", payload: {
        scenarioId: "fixture-scenario", prompt: "Inspect the page.", verificationEnabled,
      } });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("invalid_request");
      expect(startRun).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([1, 2, 99])("returns HTTP 409 for replay version %s without changing saved files", async version => {
    const dataRoot = await mkdtemp(join(tmpdir(), "cua-unsupported-replay-"));
    const path = join(dataRoot, "runs", "historical-run", "replay.json");
    const original = JSON.stringify({ version, run: { id: "historical-run" }, preserved: "untouched" });
    await mkdir(join(dataRoot, "runs", "historical-run"), { recursive: true });
    await writeFile(path, original);
    const app = createServer({ dataRoot });
    try {
      for (const route of ["", "/replay", "/events", "/stop"]) {
        const response = await app.inject({ method: route === "/stop" ? "POST" : "GET", url: `/api/runs/historical-run${route}` });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: "unsupported_replay_version" });
      }
      expect(await readFile(path, "utf8")).toBe(original);
    } finally { await app.close(); await rm(dataRoot, { recursive: true, force: true }); }
  });

  it("reports health", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: "ok",
        service: "runner",
      });
    } finally {
      await app.close();
    }
  });

  it("starts, retrieves, stops, and resets scenarios", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "cua-sample-runner-server-"));
    const app = createServer({
      dataRoot,
      manager: new RunnerManager({
        dataRoot,
        executorFactory: () => ({ execute: async ({ signal }) => new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        }) }),
      }),
    });

    try {
      const idleResponse = await app.inject({ method: "GET", url: "/api/runs/active" });
      expect(idleResponse.statusCode).toBe(200);
      expect(idleResponse.json()).toBeNull();
      const startResponse = await app.inject({
        method: "POST",
        payload: {
          browserMode: "headless",
          maxResponseTurns: 17,
          prompt: "Complete fixture.",
          scenarioId: "fixture-scenario",
        },
        url: "/api/runs",
      });

      expect(startResponse.statusCode).toBe(202);
      const started = startRunResponseSchema.parse(startResponse.json());
      expect(started.detail.run.id).toBe(started.runId);
      expect(started.detail.run.browserMode).toBe("headless");

      const activeResponse = await app.inject({ method: "GET", url: "/api/runs/active" });
      expect(activeResponse.statusCode).toBe(200);
      expect(runDetailSchema.parse(activeResponse.json()).run.id).toBe(started.runId);

      const runResponse = await app.inject({
        method: "GET",
        url: `/api/runs/${started.runId}`,
      });

      expect(runResponse.statusCode).toBe(200);
      const rawDetail = runResponse.json();
      const detail = runDetailSchema.parse(rawDetail);

      expect(detail.run.id).toBe(started.runId);
      expect(detail.run.maxResponseTurns).toBe(17);
      expect(detail.run.browserMode).toBe("headless");
      expect(detail.run.status).toBe("running");
      expect(detail.run).not.toHaveProperty("verificationEnabled");

      const stopResponse = await app.inject({
        method: "POST",
        url: `/api/runs/${started.runId}/stop`,
      });

      expect(stopResponse.statusCode).toBe(200);
      expect(runDetailSchema.parse(stopResponse.json()).run.status).toBe(
        "cancelled",
      );
      expect((await app.inject({ method: "GET", url: "/api/runs/active" })).json()).toBeNull();

      const restarted = await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: { scenarioId: "fixture-scenario", prompt: "Start a fresh run." },
      });
      const resetResponse = await app.inject({
        method: "POST",
        url: "/api/scenarios/fixture-scenario/reset",
      });

      expect(resetResponse.statusCode).toBe(200);
      expect(scenarioResetResponseSchema.parse(resetResponse.json())).toMatchObject({
        scenarioId: "fixture-scenario",
        cancelledRunId: restarted.json().runId,
      });
      expect((await app.inject({ method: "GET", url: "/api/runs/active" })).json()).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("serves the validated scenario registry", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/scenarios",
      });

      expect(response.statusCode).toBe(200);
      const scenarios = response.json();
      expect(scenariosResponseSchema.parse(scenarios)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("logs unexpected failures while returning the generic error envelope", async () => {
    const failure = new Error("Private filesystem error details");
    const manager = {
      getActiveRunDetail: async () => { throw failure; },
      shutdown: async () => {},
    } as unknown as RunnerManager;
    const app = createServer({ manager });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await app.inject({ method: "GET", url: "/api/runs/active" });
      expect(response.statusCode).toBe(500);
      expect(runnerErrorResponseSchema.parse(response.json())).toMatchObject({
        code: "internal_runner_error", error: "Internal runner error",
      });
      expect(response.body).not.toContain(failure.message);
      expect(log).toHaveBeenCalledWith("Unexpected runner request error:", failure);
    } finally { await app.close(); log.mockRestore(); }
  });

  it("rejects a turn budget above 50", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "POST",
        payload: {
          maxResponseTurns: 51,
          prompt: "Complete fixture.",
          scenarioId: "fixture-scenario",
        },
        url: "/api/runs",
      });

      expect(response.statusCode).toBe(400);
      expect(runnerErrorResponseSchema.parse(response.json())).toMatchObject({
        code: "invalid_request",
        error: expect.stringContaining("maxResponseTurns"),
      });
    } finally {
      await app.close();
    }
  });

  it("returns the structured error envelope for invalid requests", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "POST",
        payload: {
          scenarioId: "",
        },
        url: "/api/runs",
      });

      expect(response.statusCode).toBe(400);
      expect(runnerErrorResponseSchema.parse(response.json())).toMatchObject({
        code: "invalid_request",
        hint: expect.stringContaining("shared API contracts"),
      });
    } finally {
      await app.close();
    }
  });

  it("returns the structured error envelope for missing runs", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/runs/missing-run",
      });

      expect(response.statusCode).toBe(404);
      expect(runnerErrorResponseSchema.parse(response.json())).toMatchObject({
        code: "run_not_found",
        hint: expect.stringContaining("Start a new run"),
      });
    } finally {
      await app.close();
    }
  });
});

describe("runner request boundaries", () => {
  it("rejects unknown fields before calling the runner", async () => {
    const startRun = vi.fn();
    const app = createServer({ manager: { startRun, shutdown: async () => undefined } as unknown as RunnerManager });
    try {
      const response = await app.inject({ method: "POST", url: "/api/runs", payload: {
        scenarioId: "fixture-scenario", unexpected: true, browserMode: "headless", prompt: "Complete fixture.",
      } });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("invalid_request");
      expect(startRun).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("allows the shared console origin and denies foreign origins before execution", async () => {
    const startRun = vi.fn();
    const app = createServer({ manager: { startRun, shutdown: async () => undefined } as unknown as RunnerManager });
    try {
      for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"]) {
        const response = await app.inject({ method: "OPTIONS", url: "/api/runs", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
        expect(response.statusCode).toBe(204);
        expect(response.headers["access-control-allow-origin"]).toBe(origin);
      }
      for (const origin of ["https://untrusted.example", "http://localhost:3041", "http://localhost:9999", "http://localhost.attacker.example:3000", "null"]) {
        const response = await app.inject({ method: "POST", url: "/api/runs", headers: { origin }, payload: { scenarioId: "fixture-scenario", prompt: "test" } });
        expect(response.statusCode).toBe(403);
        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      }
      expect(startRun).not.toHaveBeenCalled();
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it("supports explicit additional operator origins", async () => {
    const app = createServer({ allowedOrigins: ["https://operator.example"] });
    try {
      const response = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://operator.example" } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("https://operator.example");
    } finally { await app.close(); }
  });

  it("rejects encoded traversal before accessing run artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-boundary-test-"));
    const dataRoot = join(root, "data");
    await mkdir(join(root, "outside", "screenshots"), { recursive: true });
    await writeFile(join(root, "outside", "screenshots", "marker.txt"), "outside data root");
    await writeFile(join(root, "outside", "replay.json"), '{"outside":true}');
    const app = createServer({ dataRoot });
    try {
      for (const suffix of ["", "/replay", "/events", "/artifacts/screenshots/marker.txt"]) {
        const response = await app.inject({ method: "GET", url: `/api/runs/..%2F..%2Foutside${suffix}` });
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe("invalid_request");
      }
      const stop = await app.inject({ method: "POST", url: "/api/runs/..%2F..%2Foutside/stop" });
      expect(stop.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it("returns malformed JSON as a client error", async () => {
    const app = createServer();
    try {
      const response = await app.inject({ method: "POST", url: "/api/runs", headers: { "content-type": "application/json" }, payload: "{invalid" });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("invalid_request");
    } finally { await app.close(); }
  });

  it("replays a persisted terminal run with allowed-origin SSE headers", async () => {
    const scenario = listScenarios()[0]!;
    const detail = runDetailSchema.parse({
      run: { id: "test-run", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headless", model: "test", maxResponseTurns: 24, prompt: "test", status: "completed", startedAt: "2026-09-03T00:00:00.000Z" },
      scenario, workspacePath: "/tmp/test", eventStreamUrl: "/api/runs/test-run/events", replayUrl: "/api/runs/test-run/replay",
      events: [{ id: "test-run:0", runId: "test-run", sequence: 0, type: "run_completed", level: "ok", message: "Done", createdAt: "2026-09-03T00:00:00.000Z" }],
    });
    const subscribe = vi.fn();
    const app = createServer({ manager: { getRunDetail: async () => detail, subscribe, shutdown: async () => undefined } as unknown as RunnerManager });
    try {
      const response = await app.inject({ method: "GET", url: "/api/runs/test-run/events", headers: { origin: "http://127.0.0.1:3000" } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
      expect(response.body).toContain('"type":"run_completed"');
      expect(subscribe).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("returns a JSON error if a stored running replay has no live subscription", async () => {
    const scenario = listScenarios()[0]!;
    const detail = runDetailSchema.parse({
      run: { id: "orphaned-run", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headless", model: "test", maxResponseTurns: 24, prompt: "test", status: "running", startedAt: "2026-09-03T00:00:00.000Z" },
      scenario, workspacePath: "/tmp/test", eventStreamUrl: "/api/runs/orphaned-run/events", replayUrl: "/api/runs/orphaned-run/replay", events: [],
    });
    const app = createServer({ manager: {
      getRunDetail: async () => detail,
      subscribe: () => { throw new RunnerCoreError("Run is no longer active.", { code: "run_not_active", statusCode: 404 }); },
      shutdown: async () => undefined,
    } as unknown as RunnerManager });
    try {
      const response = await app.inject({ method: "GET", url: "/api/runs/orphaned-run/events" });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json().code).toBe("run_not_active");
    } finally { await app.close(); }
  });

  it.each(["before subscription", "during the fresh snapshot"])("includes completion %s exactly once and closes SSE", async (timing) => {
    const scenario = listScenarios()[0]!;
    const started: RunEvent = { id: "race:0", runId: "race", sequence: 0, type: "run_started", level: "ok", message: "Started", createdAt: "2026-09-03T00:00:00.000Z" };
    const completed: RunEvent = { ...started, id: "race:1", sequence: 1, type: "run_completed", message: "Done" };
    const initial = runDetailSchema.parse({
      run: { id: "race", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headless", model: "test", maxResponseTurns: 24, prompt: "test", status: "running", startedAt: started.createdAt },
      scenario, workspacePath: "/tmp/race", eventStreamUrl: "/api/runs/race/events", replayUrl: "/api/runs/race/replay", events: [started],
    });
    let listener: ((event: RunEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const getRunDetail = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(async () => {
        if (timing === "during the fresh snapshot") listener?.(completed);
        return { ...initial, run: { ...initial.run, status: "completed" }, events: [started, completed] };
      });
    const app = createServer({ manager: {
      getRunDetail,
      subscribe: (_runId: string, callback: (event: RunEvent) => void) => { listener = callback; return unsubscribe; },
      shutdown: async () => undefined,
    } as unknown as RunnerManager });
    try {
      const response = app.inject({ method: "GET", url: "/api/runs/race/events" });
      await vi.waitFor(() => expect(getRunDetail).toHaveBeenCalledTimes(2));
      const body = (await response).body;
      const events = body.trim().split("\n\n").map((frame) => JSON.parse(frame.slice(6)));
      expect(events.map((event: RunEvent) => event.type)).toEqual(["run_started", "run_completed"]);
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });
});


it("waits for active executor teardown when the server closes", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "cua-shutdown-test-"));
  let aborted = false;
  let finished = false;
  let releaseTeardown!: () => void;
  const teardown = new Promise<void>((resolve) => { releaseTeardown = resolve; });
  const manager = new RunnerManager({ dataRoot, executorFactory: () => ({
    execute: async ({ signal }) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      aborted = true;
      await teardown;
      finished = true;
    },
  }) });
  const app = createServer({ dataRoot, manager });
  try {
    const started = await app.inject({ method: "POST", url: "/api/runs", payload: { scenarioId: "fixture-scenario", prompt: "test shutdown" } });
    expect(started.statusCode).toBe(202);
    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(closed).toBe(false);
    releaseTeardown();
    await closing;
    expect(finished).toBe(true);
    expect((await manager.getRunDetail(started.json().runId)).run.status).toBe("cancelled");
  } finally {
    releaseTeardown();
    await app.close();
  }
});


it("ends live SSE clients when the server closes", async () => {
  const scenario = listScenarios()[0]!;
  const detail = runDetailSchema.parse({
    run: { id: "test-run", scenarioId: scenario.id, labId: scenario.labId, browserMode: "headless", model: "test", maxResponseTurns: 24, prompt: "test", status: "running", startedAt: "2026-09-03T00:00:00.000Z" },
    scenario, workspacePath: "/tmp/test", eventStreamUrl: "/api/runs/test-run/events", replayUrl: "/api/runs/test-run/replay",
    events: [{ id: "test-run:0", runId: "test-run", sequence: 0, type: "run_started", level: "ok", message: "Started", createdAt: "2026-09-03T00:00:00.000Z" }],
  });
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => unsubscribe);
  const shutdown = vi.fn(async () => undefined);
  const app = createServer({ manager: { getRunDetail: async () => detail, subscribe, shutdown } as unknown as RunnerManager });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const ended = new Promise<void>((resolve, reject) => {
      get(`${address}/api/runs/test-run/events`, (response) => {
        response.on("end", resolve);
        response.on("error", reject);
        response.resume();
      }).on("error", reject);
    });
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    await app.close();
    await ended;
    expect(shutdown).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { await app.close(); }
});
