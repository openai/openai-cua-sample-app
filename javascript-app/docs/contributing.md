# Contributing to the JavaScript app

Follow the [quickstart](../README.md#first-run) first. Run the commands below from `javascript-app/`.

## Development and checks

`pnpm dev` starts both services. For separate logs, use one terminal per service:

```bash
pnpm dev:runner
pnpm dev:web
```

Run the app checks:

```bash
pnpm check
```

This runs lint, type checks, app tests, and a production build. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, or `pnpm build` individually when needed. These checks do not call the API.

For lab changes or affected runtime adapters, also run the [shared lab and integration checks](../../labs/docs/contributing.md#checks). Live checks are opt-in and documented there.

After building, start production services in separate terminals:

```bash
pnpm --filter @cua-sample/runner start
pnpm --filter @cua-sample/demo-web start
```

[CI](../../.github/workflows/javascript-app.yml) runs app checks, lab integration, and production startup. Before release, follow the quickstart from a fresh installation and try a verified run in both headless and visible mode, including Stop. State which checks you ran in the pull request.

## Where to make changes

- **Model and runner settings:** `.env`, using [`.env.example`](../.env.example).
- **Model/tool interaction:** [`responses-loop.ts`](../packages/runner-core/src/responses-loop.ts).
- **Runtime and lifecycle:** follow the [code map](architecture.md#code-map).
- **Lab prompts, tasks, templates, or a new scenario:** follow the [lab contribution guide](../../labs/docs/contributing.md).

Keep public contracts in `replay-schema`, lifecycle and scenario adapters in `runner-core`, and process control in `browser-runtime`. App tests use synthetic scenarios; lab-specific tests belong under `labs/tests/`.
