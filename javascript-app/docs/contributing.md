# Contributing

Keep public contracts in `replay-schema`, scenario behavior in `runner-core`, and HTTP and UI layers focused on transport and presentation. See the [setup guide](../README.md) and [architecture](architecture.md) before making changes.

## Add a scenario

Choose an existing shared lab template. For template changes, follow the [lab contributing guide](../../labs/docs/contributing.md).

When introducing a new lab ID, category, or verification kind, extend the corresponding closed enum (`labIdSchema`, `categorySchema`, or `verificationKindSchema`) in [`replay-schema`](../packages/replay-schema/src/index.ts). Scenarios that reuse existing values need no enum change.

1. Define a default prompt and register the manifest in [`scenario-kit/src/scenarios.ts`](../packages/scenario-kit/src/scenarios.ts), including its template path, start target, and verification description.
2. Add model instructions, prompt parsing, and verification helpers in `packages/runner-core/src/`. Validate required fields before model execution. Put task prompts and verification rules in the [lab task guide](../../labs/docs/scenarios.md).
3. Add an executor under `packages/runner-core/src/scenarios/` and register it in [`executor-registry.ts`](../packages/runner-core/src/executor-registry.ts).
4. Add the scenario ID to `finalizeScenario` in [`javascript-worker.ts`](../packages/runner-core/src/javascript-worker.ts). This handler owns artifact retention and optional verification. It runs even when verification is disabled; omitting a case fails the run with `Unsupported scenario`.
5. Cover the manifest, execution, finalization, and relevant failure or cancellation paths with tests. Add UI tests when the interaction changes.

## Checks

From `javascript-app/`, run:

```bash
pnpm check
pnpm test:paint:browser
```

`pnpm check` runs lint, type checks, automated tests, and a production build. Lint also checks the repository-root labs. The [GitHub Actions workflow](../../.github/workflows/javascript-app.yml) runs these checks and the paint browser checks with Chromium; it does not run live API tests.

For changes to the Responses integration, opt into the smoke tests with a key in `javascript-app/.env`:

```bash
pnpm test:live
```

This command loads the same runner environment file and sends real API requests. Describe relevant validation in the pull request, including any checks you could not run.
