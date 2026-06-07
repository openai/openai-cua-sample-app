# GPT-5.4 CUA Sample App

TypeScript sample app for browser-focused computer-use workflows with GPT-5.4. The repo includes:

- `apps/demo-web`: a Next.js operator console for starting runs and reviewing screenshots, events, and replay artifacts
- `apps/runner`: a Fastify runner that manages mutable workspaces, browser sessions, SSE, and replay bundles
- `packages/*`: shared scenario, runtime, and contract packages that make it easy to add new labs later

The legacy Python sample does not ship in this release branch. Keep that history on a separate `v1` or `legacy` branch.

## What This Repo Demonstrates

- how to integrate the Responses API from one canonical place: `packages/runner-core/src/responses-loop.ts`
- how to switch between `code` mode and `native` computer mode against the same browser lab
- how to define scenario manifests, launch isolated run workspaces, and verify outcomes
- how to build an operator-facing console that is understandable even when the runner is offline or a run fails

## Prerequisites

- Node.js `22.20.0`
- pnpm `10.26.0`
- Playwright Chromium browser install

## First Run

```bash
git clone <repo-url>
cd openai-cua-sample-app
corepack enable
pnpm install
cp .env.example .env
```

Edit `.env` and set at least this environment variable:

```bash
OPENAI_API_KEY=your_key_here
```

The runner reads the repo-root `.env` automatically when you start it through the provided scripts. The web app uses its built-in defaults; if you need to override `NEXT_PUBLIC_*` settings, add them in `apps/demo-web/.env.local`.

If `pnpm install` prints an `Ignored build scripts` warning for optional packages such as `sharp` or `esbuild`, you can ignore it for local development in this repo. A clean clone still installs, builds, and starts successfully without approving those scripts.

Install the Playwright browser:

```bash
pnpm playwright:install
```

On Linux, install Playwright OS dependencies as well:

```bash
pnpm playwright:install:with-deps
```

If Playwright later reports missing system libraries, rerun the `with-deps` command above and follow any OS package prompts it prints.

Start both apps together:

```bash
pnpm dev
```

Open [http://127.0.0.1:3000][def], choose a scenario, keep `Headless` selected, and start a run.

## Local Development

Run the services separately if you want independent logs:

```bash
pnpm dev:runner
RUNNER_BASE_URL=http://127.0.0.1:4001 pnpm dev:web
```

Common checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Live smoke tests stay opt-in and secret-gated:

```bash
OPENAI_API_KEY=your_key_here pnpm test:live
```

## Execution Modes

- `native`: exposes the Responses API computer tool directly. The model requests clicks, drags, typing, waits, and screenshots against the live browser session.
- `code`: exposes a persistent Playwright JavaScript REPL through `exec_js`. The model scripts the browser rather than emitting raw computer actions.

Both modes use the same scenario manifests and replay pipeline. `native` is the closest sample of the computer tool itself. `code` is the clearest sample of a browser REPL harness.

## Official Scenarios

- `kanban-reprioritize-sprint` (`kanban`): teaches stateful drag-and-drop verification against a target board state derived from the operator prompt
- `paint-draw-poster` (`paint`): teaches cursor control, drawing, and verifying saved canvas state against the live canvas
- `booking-complete-reservation` (`booking`): teaches multi-step browsing and form completion with verification against a local confirmation record

More detail lives in [docs/scenarios.md](docs/scenarios.md).

## Repo Map

- `apps/demo-web`
  The operator console UI
- `apps/runner`
  The HTTP runner, SSE endpoints, and artifact serving layer
- `packages/replay-schema`
  Shared request, response, replay, and error contracts
- `packages/scenario-kit`
  Public scenario manifests and prompt defaults
- `packages/browser-runtime`
  Playwright session abstraction
- `packages/runner-core`
  Orchestration, Responses loop, scenario executors, and verification
- `labs`
  Static lab templates copied into run-scoped workspaces
- `docs`
  Architecture, scenarios, and contribution guidance

## Environment Variables

Runner:

- `OPENAI_API_KEY`
- `HOST` (default `127.0.0.1`)
- `PORT` (default `4001`)
- `CUA_DEFAULT_MODEL` (default `gpt-5.4`)
- `CUA_RESPONSES_MODE` (`auto`, `fallback`, or `live`)

Web:

- `RUNNER_BASE_URL` (default `http://127.0.0.1:4001`)
- `NEXT_PUBLIC_CUA_DEFAULT_MODEL` (default `gpt-5.4`)
- `NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS` (default `24`)

See [.env.example](.env.example) for a minimal local template.

## Safety And Limitations

- Computer use remains high risk. Do not point this sample at authenticated, financial, medical, or otherwise high-stakes environments.
- This repo is intentionally browser-focused. Workspace patching and file-editing scenarios are out of scope for the OSS release branch.
- Pending computer-use safety acknowledgements are not implemented in this sample yet. Runs fail with the stable code `unsupported_safety_acknowledgement` when the API asks for one.
- The public scenarios are local labs designed for deterministic verification. They are not intended as proofs of general web autonomy.

## Release Validation Checklist

- clean clone on a fresh machine
- setup succeeds from this README alone
- `pnpm dev`
- one successful headless run
- one successful headful run
- one intentional failure that shows the new runner guidance cleanly


[def]: http://127.0.0.1:3000