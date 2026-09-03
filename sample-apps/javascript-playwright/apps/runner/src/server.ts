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
  manager?: RunnerManager;
  stepDelayMs?: number;
};

const defaultDataRoot = fileURLToPath(new URL("../../../data", import.meta.url));

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

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "content-type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

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
      eventStreamUrl: detail.eventStreamUrl,
      replayUrl: detail.replayUrl,
      runId: detail.run.id,
      status: detail.run.status,
    });
  });

  app.get("/api/runs/:id", async (request) =>
    runDetailSchema.parse(
      await manager.getRunDetail((request.params as { id: string }).id),
    ),
  );

  app.post("/api/runs/:id/stop", async (request) =>
    runDetailSchema.parse(
      await manager.stopRun((request.params as { id: string }).id),
    ),
  );

  app.get("/api/runs/:id/replay", async (request) =>
    manager.getReplayBundle((request.params as { id: string }).id),
  );

  app.get("/api/runs/:id/artifacts/screenshots/:name", async (request, reply) => {
    const params = request.params as { id: string; name: string };
    const screenshotPath = resolve(
      resolvedDataRoot,
      "runs",
      params.id,
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
    const runId = (request.params as { id: string }).id;
    const detail = await manager.getRunDetail(runId);

    reply.raw.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });

    for (const event of detail.events) {
      writeSseEvent(reply, event);
    }

    const unsubscribe = manager.subscribe(runId, (event: RunEvent) => {
      writeSseEvent(reply, event);
    });

    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });

    return reply.hijack();
  });

  return app;
}
