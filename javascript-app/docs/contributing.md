# Contributing

Keep public contracts in `replay-schema`, scenario behavior in `runner-core`, and HTTP and UI layers focused on transport and presentation. See the [setup guide](../README.md) and [architecture](architecture.md) before making changes.

## Add a scenario

When introducing a new lab ID, category, or verification kind, extend the corresponding closed enum (`labIdSchema`, `categorySchema`, or `verificationKindSchema`) in [`replay-schema`](../packages/replay-schema/src/index.ts). Scenarios that reuse existing values need no enum change.

1. Add a self-contained template under the repository-root `labs/<name>-lab-template/`.
2. Define a default prompt and register the manifest in [`scenario-kit/src/scenarios.ts`](../packages/scenario-kit/src/scenarios.ts), including its template, start target, and verification description.
3. Add instructions, prompt parsing, and verification helpers in `packages/runner-core/src/`. If verification needs a structured prompt, validate it before model execution and document an example.
4. Add an executor under `packages/runner-core/src/scenarios/` and register it in [`executor-registry.ts`](../packages/runner-core/src/executor-registry.ts).
5. Add the scenario ID to `finalizeScenario` in [`javascript-worker.ts`](../packages/runner-core/src/javascript-worker.ts). This handler owns artifact retention and optional verification. It runs even when verification is disabled; omitting a case fails the run with `Unsupported scenario`.
6. Cover the manifest, execution, finalization, and relevant failure or cancellation paths with tests. Add UI tests when the interaction changes.

## Lab and verification design

Keep template assets local and make the initial state readable from screenshots. Expose stable browser-side accessors for verification, and keep the template resettable by copying it into a fresh workspace.

Verify the requested final lab state. Include enough observed and expected detail in failures to make replay review useful. Artifact capture should state what is retained when verification is disabled or the run is interrupted.

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
