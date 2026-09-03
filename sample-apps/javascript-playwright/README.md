# JavaScript + Playwright sample app

TypeScript sample app for browser-focused computer-use workflows. Start here to follow a task from the Responses API, through JavaScript execution, to a verified result and replay. The workspace includes:

- `apps/demo-web`: a Next.js operator console for starting runs and reviewing screenshots, events, and replay artifacts
- `apps/runner`: a Fastify runner that manages mutable workspaces, browser sessions, SSE, and replay bundles
- `packages/*`: shared scenario, runtime, and contract packages that make it easy to add new labs later

## What This Repo Demonstrates

- how to integrate the Responses API in the [model loop](packages/runner-core/src/responses-loop.ts)
- how to drive browser labs through a persistent Playwright JavaScript REPL using `exec_js`
- how to run model code in an [execution worker](packages/runner-core/src/javascript-worker.ts) that the runner can stop
- how to define scenario manifests, launch isolated run workspaces, and verify outcomes
- how to build an operator-facing console that is understandable even when the runner is offline or a run fails

## Prerequisites

- Node.js `22.20.0`
- pnpm `10.26.0`
- Playwright Chromium browser install

## First Run

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app/sample-apps/javascript-playwright
corepack enable
pnpm install
cp .env.example .env
```

Edit `.env` and set at least this environment variable:

```bash
OPENAI_API_KEY=your_key_here
```

The runner reads the sample-app `.env` automatically when you start it through the provided scripts. The web app uses its built-in defaults; to override `RUNNER_BASE_URL` or `NEXT_PUBLIC_*` settings, set them in the shell or in `apps/demo-web/.env.local`.

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

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), choose a scenario, keep `Headless` selected, and start a run.

The console fits the window, with run actions at the top and controls and activity scrolling in their own panels. Below 960px, use **Controls**, **Preview**, and **Activity** to switch panels without losing your draft or selected frame. The timeline slider stays visible; **Show thumbnails** expands the frame strip.

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
pnpm test:paint:browser
```

These commands run from this directory. From the repository root, use `pnpm --dir sample-apps/javascript-playwright <command>`. The lint command explicitly checks both this workspace and the repository-root labs using this app's ESLint configuration.

After building, start the production services in separate terminals:

```bash
pnpm --filter @cua-sample/runner start
pnpm --filter @cua-sample/demo-web start
```

Live smoke tests use real API requests and require a key. To use the sample-app `.env` without placing the key in your shell command:

```bash
node --env-file=.env node_modules/vitest/vitest.mjs run --root packages/runner-core test/live-responses.smoke.test.ts
```

## Browser Execution

Every run uses a persistent Playwright JavaScript REPL exposed through `exec_js`. The model scripts the live browser session, and the runner records tool activity, screenshots, and scenario verification results. Browser visibility remains configurable as `headless` or `headful`.

The main runner owns the API client, HTTP/SSE server, run records, execution deadline, and Chromium browser-server handle. One child process per run owns the JavaScript context and Playwright page. Successful calls retain `globalThis`, `page`, `console.log`, and `display()`; each run gets a fresh context. Script exceptions are returned as tool output so the model can correct them.

Stop and the 20-second execution deadline terminate the worker and Chromium, including when JavaScript loops forever or a browser operation remains pending. A timeout, worker crash, or invalid worker response fails the run after cleanup. The next run can start once cleanup finishes.

The runner copies each root lab template into a fresh workspace under this sample app's `data/` directory. New replay records, screenshots, and saved artwork stay there. Existing data from an earlier repository layout is left in place.

## API And Replay Changes

Execution mode has been removed from the API. Omit `mode` when calling `POST /api/runs`; requests containing `mode: "code"`, `mode: "native"`, or any other unknown field receive HTTP 400. Run records no longer include `mode`, and scenario manifests no longer include `defaultMode`.

New replay bundles use version `2` and contain function-call events from the REPL. Existing saved replay files remain untouched. This release does not migrate old bundles or support displaying historical native runs.

## Official Scenarios

- `kanban-reprioritize-sprint` (`kanban`): teaches stateful drag-and-drop verification against a target board state derived from the operator prompt
- `paint-draw-poster` (`paint`): Sketch Studio, a raster editor for drawing with tools, layers, text, and verifiable saved artwork
- `booking-complete-reservation` (`booking`): teaches multi-step browsing and form completion with verification against a local confirmation record

More detail lives in [docs/scenarios.md](docs/scenarios.md).

Use the supplied Kanban prompt to specify ordered `backlog`, `in_progress`, and `done` columns (an empty column is allowed). For Booking, use the supplied hotel, dates, guest, and requirements fields. These structured prompts are checked before model execution when verification is enabled. Paint accepts a drawing request such as the one below.

## Sketch Studio

The paint lab opens a 1024 × 768 raster document with brush/pencil, eraser, fill, eyedropper, shapes, text, rectangular selection, up to eight layers, undo/redo, and zoom/pan. The model operates its visible controls through the same persistent Playwright REPL as the other labs.

**Save draft** stores a version-2 save record containing the artwork and layers in IndexedDB. Reload recovery works within the same lab origin and browser context; a new run starts fresh. **Export PNG** downloads the current artwork without editor chrome and does not update the saved draft.

After normal model completion, the runner retains the last saved draft as `artwork/draft.png` and `artwork/draft.sketch.json` inside the run workspace, before optional verification and teardown. Capture also runs when verification is off, and the file paths appear in run events and the summary. No saved draft means no retained paint artifacts. Invalid image data or filesystem write errors fail the run. Cancelled or interrupted runs may end before capture.

Optional paint verification checks that a nonblank saved document matches the current layers and rendered pixels. Visual review is still needed to assess whether the artwork depicts the requested subject.

Try: “Draw a yellow smiley face with black eyes and a curved smile, then save the draft.” See the [paint lab guide](../../labs/paint-lab-template/README.md) for controls and persistence details. The live paint smoke test covers both headless and visible Chromium.

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
  Parent browser lifecycle and small worker protocol
- `packages/runner-core`
  Orchestration, Responses loop, scenario executors, and verification
- [`../../labs`](../../labs)
  Repository-root templates copied into run-scoped workspaces
- `docs`
  Architecture, scenarios, and contribution guidance

## Environment Variables

Runner:

- `OPENAI_API_KEY`
- `HOST` (default `127.0.0.1`)
- `PORT` (default `4001`)
- `CUA_DEFAULT_MODEL` (default `gpt-5.6-sol`)
- `CUA_RESPONSES_MODE` (`auto`, `fallback`, or `live`)
- `CUA_ALLOWED_ORIGINS` (optional comma-separated browser origins; local console origins on ports 3000 and 3041 are allowed by default)

Web:

- `RUNNER_BASE_URL` (default `http://127.0.0.1:4001`)
- `NEXT_PUBLIC_CUA_DEFAULT_MODEL` (default `gpt-5.6-sol`)
- `NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS` (default `24`)

See [.env.example](.env.example) for a minimal local template.

## Safety And Limitations

- Computer use remains high risk. Do not point this sample at authenticated, financial, medical, or otherwise high-stakes environments.
- This repo is intentionally browser-focused. Workspace patching and file-editing scenarios are out of scope for the OSS release branch.
- The public scenarios are local labs designed for deterministic verification. They are not intended as proofs of general web autonomy.

## Release Validation Checklist

- clean clone on a fresh machine
- setup succeeds from this README alone
- `pnpm dev`
- one successful headless run
- one successful headful run
- one intentional failure that shows the new runner guidance cleanly
