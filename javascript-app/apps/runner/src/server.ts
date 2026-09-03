import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";

import Fastify, { type FastifyReply } from "fastify";

import {
  runDetailSchema,
  runnerErrorResponseSchema,
  scenarioWorkspaceStateSchema,
  scenariosResponseSchema,
  startRunRequestSchema,
  startRunResponseSchema,
  type RunEvent,
} from "@cua-sample/replay-schema";
import {
  RunnerCoreError,
  RunnerManager,
  toRunnerErrorResponse,
} from "@cua-sample/runner-core";
import { listScenarios } from "@cua-sample/scenario-kit";

type CreateServerOptions = {
  dataRoot?: string;
  allowedOrigins?: string[];
  manager?: RunnerManager;
  stepDelayMs?: number;
};

const defaultDataRoot = fileURLToPath(new URL("../../../data", import.meta.url));

const defaultAllowedOrigins = ["http:", "https:"].flatMap((protocol) =>
  ["localhost", "127.0.0.1", "[::1]"].flatMap((host) =>
    [3000, 3041].map((port) => `${protocol}//${host}:${port}`),
  ),
);

function validateRunId(runId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new RunnerCoreError("Invalid run ID.", {
      code: "invalid_request",
      hint: "Use the run ID returned when starting a run.",
      statusCode: 400,
    });
  }
  return runId;
}

function writeSseEvent(reply: FastifyReply, payload: unknown) {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createServer(options: CreateServerOptions = {}) {
  const resolvedDataRoot = resolve(options.dataRoot ?? defaultDataRoot);
  const managerOptions = {
    dataRoot: resolvedDataRoot,
    ...(options.stepDelayMs === undefined
      ? {}
      : { stepDelayMs: options.stepDelayMs }),
  };
  const manager = options.manager ?? new RunnerManager(managerOptions);
  const app = Fastify({ logger: false });
  const eventStreams = new Set<FastifyReply["raw"]>();
  app.addHook("preClose", async () => {
    try {
      await manager.shutdown();
    } finally {
      for (const stream of eventStreams) stream.end();
      eventStreams.clear();
    }
  });
  const allowedOrigins = new Set([
    ...defaultAllowedOrigins,
    ...(options.allowedOrigins ?? process.env.CUA_ALLOWED_ORIGINS?.split(",") ?? [])
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return reply.code(403).send({
        code: "origin_not_allowed",
        error: "This origin is not allowed to access the runner.",
        hint: "Use the local operator console or configure CUA_ALLOWED_ORIGINS.",
      });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("Vary", "Origin");
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Headers", "content-type");
      reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    return payload;
  });

  app.options("*", async (_request, reply) => {
    reply.code(204);
    return null;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RunnerCoreError) {
      reply.code(error.statusCode).send(
        runnerErrorResponseSchema.parse(toRunnerErrorResponse(error)),
      );
      return;
    }

    if (error instanceof Error && "issues" in error) {
      reply.code(400).send(
        runnerErrorResponseSchema.parse({
          code: "invalid_request",
          error: error.message,
          hint:
            "Review the request payload against the published replay-schema contracts.",
        }),
      );
      return;
    }

    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 && error.statusCode < 500
    ) {
      reply.code(error.statusCode).send({
        code: "invalid_request",
        error: error.message,
        hint: "Send a valid JSON request matching the replay-schema contracts.",
      });
      return;
    }

    console.error("Unexpected runner request error:", error);
    reply.code(500).send(
      runnerErrorResponseSchema.parse({
        code: "internal_runner_error",
        error: "Internal runner error",
        hint: "Check the runner logs for the full stack trace.",
      }),
    );
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "runner",
  }));

  app.get("/api/scenarios", async () =>
    scenariosResponseSchema.parse(listScenarios()),
  );

  app.post("/api/scenarios/:id/reset", async (request) =>
    scenarioWorkspaceStateSchema.parse(
      await manager.resetScenario(
        (request.params as { id: string }).id,
      ),
    ),
  );

  app.post("/api/runs", async (request, reply) => {
    const input = startRunRequestSchema.parse(request.body);
    const detail = await manager.startRun(input);

    reply.code(202);

    return startRunResponseSchema.parse({
      detail,
      eventStreamUrl: detail.eventStreamUrl,
      replayUrl: detail.replayUrl,
      runId: detail.run.id,
      status: detail.run.status,
    });
  });

  app.get("/api/runs/active", async () => {
    const detail = await manager.getActiveRunDetail();
    return detail === null ? null : runDetailSchema.parse(detail);
  });

  app.get("/api/runs/:id", async (request) =>
    runDetailSchema.parse(
      await manager.getRunDetail(validateRunId((request.params as { id: string }).id)),
    ),
  );

  app.post("/api/runs/:id/stop", async (request) =>
    runDetailSchema.parse(
      await manager.stopRun(validateRunId((request.params as { id: string }).id)),
    ),
  );

  app.get("/api/runs/:id/replay", async (request) =>
    manager.getReplayBundle(validateRunId((request.params as { id: string }).id)),
  );

  app.get("/api/runs/:id/artifacts/screenshots/:name", async (request, reply) => {
    const params = request.params as { id: string; name: string };
    const screenshotPath = resolve(
      resolvedDataRoot,
      "runs",
      validateRunId(params.id),
      "screenshots",
      basename(params.name),
    );

    try {
      const payload = await readFile(screenshotPath);

      reply.header("Content-Type", "image/png");
      return payload;
    } catch {
      reply.code(404);
      return runnerErrorResponseSchema.parse({
        code: "artifact_not_found",
        error: "Screenshot artifact not found",
        hint: "Refresh the run detail and choose a screenshot that still exists on disk.",
      });
    }
  });

  app.get("/api/runs/:id/events", async (request, reply) => {
    const runId = validateRunId((request.params as { id: string }).id);
    let detail = await manager.getRunDetail(runId);
    let unsubscribe: (() => void) | undefined;
    let replaying = true;
    let lastSequence = -1;
    const buffered: RunEvent[] = [];
    const cleanup = () => {
      eventStreams.delete(reply.raw);
      unsubscribe?.();
      unsubscribe = undefined;
    };
    const sendEvent = (event: RunEvent) => {
      if (reply.raw.destroyed || reply.raw.writableEnded || event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      writeSseEvent(reply, event);
      if (["run_completed", "run_failed", "run_cancelled"].includes(event.type)) {
        cleanup();
        reply.raw.end();
      }
    };

    try {
      if (detail.run.status === "running" || detail.run.status === "queued") {
        // Buffer live events while taking a fresh snapshot, closing the gap
        // between the initial read and subscription without duplicating events.
        unsubscribe = manager.subscribe(runId, (event: RunEvent) => {
          if (replaying) buffered.push(event);
          else sendEvent(event);
        });
        detail = await manager.getRunDetail(runId);
      }

      eventStreams.add(reply.raw);
      reply.raw.on("close", cleanup);
      reply.raw.writeHead(200, {
        ...(request.headers.origin ? { "Access-Control-Allow-Origin": request.headers.origin } : {}),
        Vary: "Origin",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });

      for (const event of [...detail.events, ...buffered].sort((left, right) => left.sequence - right.sequence)) {
        sendEvent(event);
      }
      replaying = false;
      if (detail.run.status !== "running" && detail.run.status !== "queued") {
        cleanup();
        reply.raw.end();
      }
      return reply.hijack();
    } catch (error) {
      cleanup();
      throw error;
    }
  });

  return app;
}
