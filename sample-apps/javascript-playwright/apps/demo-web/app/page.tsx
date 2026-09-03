import {
  scenariosResponseSchema,
  type ScenarioManifest,
} from "@cua-sample/replay-schema";

import {
  createRunnerUnavailableIssue,
  parseRunnerIssue,
} from "./ui/operator-console/helpers";
import { OperatorConsole } from "./ui/operator-console";
import type { RunnerIssue } from "./ui/operator-console/types";

export const dynamic = "force-dynamic";

const runnerBaseUrl = process.env.RUNNER_BASE_URL ?? "http://127.0.0.1:4001";

function isRunnerIssue(value: unknown): value is RunnerIssue {
  return (
    value !== null &&
    typeof value === "object" &&
    "code" in value &&
    "error" in value &&
    "title" in value
  );
}

async function loadScenarios() {
  try {
    const response = await fetch(`${runnerBaseUrl}/api/scenarios`, {
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);

      throw parseRunnerIssue(payload) ??
        createRunnerUnavailableIssue(`Runner returned ${response.status}.`);
    }

    return {
      runnerIssue: null,
      scenarios: scenariosResponseSchema.parse(await response.json()),
    };
  } catch (error) {
    return {
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
  const { runnerIssue, scenarios } = await loadScenarios();

  return (
    <OperatorConsole
      initialRunnerIssue={runnerIssue}
      runnerBaseUrl={runnerBaseUrl}
      scenarios={scenarios}
    />
  );
}
