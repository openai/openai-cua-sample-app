# Contributing

This repo is intentionally small. New public scenarios should follow the existing package boundaries instead of adding one-off logic to the runner or UI.

## Add A Scenario

1. Add the lab template under the repository-root `labs/<name>-lab-template`.
2. Add a manifest and default prompt in `packages/scenario-kit/src`.
3. Export the manifest through `packages/scenario-kit/src/scenarios.ts`.
4. Add scenario instructions and verification helpers in `packages/runner-core/src`.
5. Register the executor in `packages/runner-core/src/executor-registry.ts`.
6. Add or update tests for the manifest, runner behavior, and any UI guidance.

## Add A Verifier

Verification belongs in `packages/runner-core`.

Guidelines:

- verify final lab state, not incidental model behavior
- prefer stable lab accessors over brittle DOM text scraping
- include enough detail in failure messages that replay review is actionable

## Add A Lab Template

Lab templates should be self-contained and resettable.

Guidelines:

- keep assets local to the template folder
- expose stable browser-side accessors for verification
- avoid network dependencies unless they are part of the scenario story
- make the initial state easy to reason about from screenshots

## Quality Gates

Before opening a PR, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm test:live` only when you have an `OPENAI_API_KEY` and want the live Responses API smoke tests.
