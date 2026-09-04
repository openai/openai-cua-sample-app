import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ScenarioManifest } from "@cua-sample/replay-schema";

vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_CUA_DEFAULT_MODEL", "  custom-web-model  ");
});
import { useRunStream } from "./useRunStream";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("sends a nonempty explicit web model override", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "Test response" }) })));
  const scenario = { id: "alternate-scenario", defaultPrompt: "Complete the demo task." } as ScenarioManifest;
  const hook = renderHook(() => useRunStream({
    initialRunnerIssue: null, runnerBaseUrl: "http://127.0.0.1:4041", scenarios: [scenario],
  }));
  await act(async () => { await hook.result.current.handleStartRun(); });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).model).toBe("custom-web-model");
});
