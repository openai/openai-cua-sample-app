import { expect, vi } from "vitest";
import type { RunRecord } from "@cua-sample/contracts";
import type { RunnerManager } from "../src/runner-manager.js";

export function waitForRunStatus(manager: RunnerManager, runId: string, status: RunRecord["status"]) {
  return vi.waitFor(async () => {
    const detail = await manager.getRunDetail(runId);
    expect(detail.run.status).toBe(status);
    return detail;
  }, { timeout: 4_000, interval: 10 });
}
