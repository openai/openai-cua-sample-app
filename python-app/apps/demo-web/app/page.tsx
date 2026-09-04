import {
  runDetailSchema,
  scenariosResponseSchema,
  type ScenarioManifest,
} from "@cua-sample/replay-schema";

import {
  createRunnerUnavailableIssue,
  parseRunnerIssue,
} from "./ui/operator-console/helpers";
import { OperatorConsole } from "./ui/operator-console";
import type { RunnerIssue } from "./ui/operator-console/types";
import { requestRunnerJson } from "./ui/operator-console/runner-request";

export const dynamic = "force-dynamic";

const runnerBaseUrl = process.env.RUNNER_BASE_URL ?? "http://127.0.0.1:4041";

function isRunnerIssue(value: unknown): value is RunnerIssue {
  return (
    value !== null &&
    typeof value === "object" &&
    "code" in value &&
    "error" in value &&
    "title" in value
  );
}

async function loadRunnerState() {
  try {
    const [registry, active] = await Promise.all([
      requestRunnerJson(`${runnerBaseUrl}/api/scenarios`, { cache: "no-store" }, 5_000),
      requestRunnerJson(`${runnerBaseUrl}/api/runs/active`, { cache: "no-store" }, 5_000),
    ]);
    for (const { response, payload } of [registry, active]) {
      if (!response.ok) {
        throw parseRunnerIssue(payload) ??
          createRunnerUnavailableIssue(`Runner returned ${response.status}.`);
      }
    }

    return {
      initialRun: runDetailSchema.nullable().parse(active.payload),
      runnerIssue: null,
      scenarios: scenariosResponseSchema.parse(registry.payload),
    };
  } catch (error) {
    return {
      initialRun: null,
      runnerIssue: isRunnerIssue(error)
        ? error
        : createRunnerUnavailableIssue(
            error instanceof Error ? error.message : undefined,
          ),
      scenarios: [] as ScenarioManifest[],
    };
  }
}

export default async function HomePage() {
  const { initialRun, runnerIssue, scenarios } = await loadRunnerState();

  return (
    <OperatorConsole
      initialRun={initialRun}
      initialRunnerIssue={runnerIssue}
      runnerBaseUrl={runnerBaseUrl}
      scenarios={scenarios}
    />
  );
}
