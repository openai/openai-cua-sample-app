import {
  backendCapabilitiesSchema,
  runDetailSchema,
  scenariosResponseSchema,
  type BackendCapabilities,
  type ScenarioManifest,
} from "@cua-sample/contracts";

import {
  createRunnerIssue,
  createRunnerUnavailableIssue,
  parseRunnerIssue,
} from "../components/helpers";
import { OperatorConsole } from "../components/OperatorConsole";
import type { RunnerIssue } from "../components/types";
import { requestRunnerJson } from "../components/runner-request";

export const dynamic = "force-dynamic";

function isRunnerIssue(value: unknown): value is RunnerIssue {
  return value !== null && typeof value === "object" &&
    "code" in value && "error" in value && "title" in value;
}

async function loadRunnerState(runnerBaseUrl: string, expectedBackend: BackendCapabilities["backendId"]) {
  let capabilities: BackendCapabilities | null = null;
  try {
    if (process.env.CUA_BACKEND && !["javascript", "python"].includes(process.env.CUA_BACKEND)) {
      throw createRunnerIssue("invalid_configuration", "CUA_BACKEND must be javascript or python.", "Start the console with one of the repository's backend launch commands.");
    }
    const options = { cache: "no-store" as const, headers: { "X-CUA-Backend": expectedBackend } };
    const descriptor = await requestRunnerJson(`${runnerBaseUrl}/api/capabilities`, options, 5_000);
    if (!descriptor.response.ok) {
      throw parseRunnerIssue(descriptor.payload) ?? createRunnerUnavailableIssue(`Runner returned ${descriptor.response.status}.`);
    }
    capabilities = backendCapabilitiesSchema.parse(descriptor.payload);
    if (capabilities.backendId !== expectedBackend) {
      throw createRunnerIssue("backend_mismatch", `Expected ${expectedBackend}, but the runner is ${capabilities.backendId}.`, "Restart the console with the selected backend.");
    }
    const [registry, active] = await Promise.all([
      requestRunnerJson(`${runnerBaseUrl}/api/scenarios`, options, 5_000),
      requestRunnerJson(`${runnerBaseUrl}/api/runs/active`, options, 5_000),
    ]);
    for (const { response, payload } of [registry, active]) {
      if (!response.ok) {
        throw parseRunnerIssue(payload) ?? createRunnerUnavailableIssue(`Runner returned ${response.status}.`);
      }
    }
    return {
      capabilities,
      initialRun: runDetailSchema.nullable().parse(active.payload),
      runnerIssue: null,
      scenarios: scenariosResponseSchema.parse(registry.payload),
    };
  } catch (error) {
    return {
      capabilities,
      initialRun: null,
      runnerIssue: isRunnerIssue(error) ? error : createRunnerUnavailableIssue(error instanceof Error ? error.message : undefined),
      scenarios: [] as ScenarioManifest[],
    };
  }
}

export default async function HomePage() {
  const expectedBackend = process.env.CUA_BACKEND === "python" ? "python" : "javascript";
  const runnerBaseUrl = process.env.RUNNER_BASE_URL ?? `http://127.0.0.1:${expectedBackend === "python" ? 4041 : 4001}`;
  const { capabilities, initialRun, runnerIssue, scenarios } = await loadRunnerState(runnerBaseUrl, expectedBackend);

  return (
    <OperatorConsole
      capabilities={capabilities}
      expectedBackend={expectedBackend}
      initialRun={initialRun}
      initialRunnerIssue={runnerIssue}
      runnerBaseUrl={runnerBaseUrl}
      scenarios={scenarios}
    />
  );
}
