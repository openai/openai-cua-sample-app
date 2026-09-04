import { afterEach, expect, it, vi } from "vitest";

import HomePage from "./page";

function json(payload: unknown) {
  return { ok: true, json: async () => payload } as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("loads scenarios and the active run together", async () => {
  const fetchMock = vi.fn(async (url: string) => json(url.endsWith("/api/scenarios") ? [] : null));
  vi.stubGlobal("fetch", fetchMock);
  const page = await HomePage();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "http://127.0.0.1:4041/api/scenarios", "http://127.0.0.1:4041/api/runs/active",
  ]);
  expect(page.props.initialRun).toBeNull();
  expect(page.props.initialRunnerIssue).toBeNull();
});

it.each(["headers", "body"])("shows recovery guidance after five seconds waiting for %s", async (stage) => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
    const signal = init.signal!;
    signals.push(signal);
    const pending = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });
    return stage === "headers" ? pending : Promise.resolve({ ok: true, json: () => pending });
  }));
  const loading = HomePage();
  await vi.advanceTimersByTimeAsync(5_000);
  const page = await loading;
  expect(page.props.initialRunnerIssue?.error).toContain("timed out");
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
