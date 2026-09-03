import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  runDetailSchema,
  runnerErrorResponseSchema,
  scenarioWorkspaceStateSchema,
  scenariosResponseSchema,
  startRunResponseSchema,
} from "@cua-sample/replay-schema";

import { createServer } from "../src/server.js";

describe("runner server", () => {
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

  it("starts, retrieves, stops, and resets scenario workspaces", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "cua-sample-runner-server-"));
    const app = createServer({
      dataRoot,
      stepDelayMs: 50,
    });

    try {
      const startResponse = await app.inject({
        method: "POST",
        payload: {
          browserMode: "headless",
          maxResponseTurns: 17,
          prompt: [
            "Reorganize the board to match this requested final board state exactly.",
            "",
            "backlog: Refresh workspace docs",
            "in_progress: Close nav bug triage -> Finalize analytics spec",
            "done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips",
          ].join("\n"),
          scenarioId: "kanban-reprioritize-sprint",
        },
        url: "/api/runs",
      });

      expect(startResponse.statusCode).toBe(202);
      const started = startRunResponseSchema.parse(startResponse.json());

      const runResponse = await app.inject({
        method: "GET",
        url: `/api/runs/${started.runId}`,
      });

      expect(runResponse.statusCode).toBe(200);
      const rawDetail = runResponse.json();
      expect(rawDetail.run).not.toHaveProperty("mode");
      expect(rawDetail.scenario).not.toHaveProperty("defaultMode");
      const detail = runDetailSchema.parse(rawDetail);

      expect(detail.run.id).toBe(started.runId);
      expect(detail.run.maxResponseTurns).toBe(17);
      expect(detail.run.browserMode).toBe("headless");
      expect(detail.run.status).toBe("running");
      expect(detail.run.verificationEnabled).toBe(false);

      const stopResponse = await app.inject({
        method: "POST",
        url: `/api/runs/${started.runId}/stop`,
      });

      expect(stopResponse.statusCode).toBe(200);
      expect(runDetailSchema.parse(stopResponse.json()).run.status).toBe(
        "cancelled",
      );

      const resetResponse = await app.inject({
        method: "POST",
        url: "/api/scenarios/kanban-reprioritize-sprint/reset",
      });

      expect(resetResponse.statusCode).toBe(200);
      expect(
        scenarioWorkspaceStateSchema.parse(resetResponse.json()).scenarioId,
      ).toBe("kanban-reprioritize-sprint");
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
      expect(scenariosResponseSchema.parse(scenarios)).toHaveLength(3);
      for (const scenario of scenarios) {
        expect(scenario).not.toHaveProperty("defaultMode");
      }
    } finally {
      await app.close();
    }
  });

  it.each(["native", "code"])("rejects the removed mode field (%s)", async (mode) => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "POST",
        payload: {
          mode,
          prompt: "Paint a smiley face and save the draft.",
          scenarioId: "paint-draw-poster",
        },
        url: "/api/runs",
      });

      expect(response.statusCode).toBe(400);
      expect(runnerErrorResponseSchema.parse(response.json())).toMatchObject({
        code: "invalid_request",
        error: expect.stringContaining("mode"),
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
        hint: expect.stringContaining("published replay-schema contracts"),
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
