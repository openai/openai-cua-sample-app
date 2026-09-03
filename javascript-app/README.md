# GPT-5.6 CUA Sample App

TypeScript sample app for browser-focused computer-use workflows with GPT-5.6 and Playwright. The app includes:

- `apps/demo-web`: a Next.js console for starting runs and reviewing screenshots, events, and replay artifacts
- `apps/runner`: a Fastify runner that manages run workspaces, browser sessions, event streams, and replay bundles
- `packages/*`: scenario, runtime, and contract packages used by the JavaScript app

See the [root README](../README.md) for repository setup, shared labs, and general guidance.

## What This Repo Demonstrates

- how to integrate the Responses API in the [model loop](packages/runner-core/src/responses-loop.ts)
- how to drive browser labs through a persistent Playwright JavaScript session using `exec_js`
- how to run model code in an [execution worker](packages/runner-core/src/javascript-worker.ts) that the runner can stop
- how to define scenarios, copy lab templates into fresh workspaces, and verify outcomes
- how to keep the console useful when a connection drops or a run fails

## Prerequisites

- Node.js `22.20.0`, pinned in [`.node-version`](.node-version)
- pnpm `10.26.0`, pinned in [`package.json`](package.json)
- Playwright Chromium, installed below
- an API key with access to the configured model, which defaults to `gpt-5.6-sol`

## First Run

[Clone the repository](../README.md#first-run), then run these commands from its root:

```bash
cd javascript-app
corepack enable
pnpm install
cp .env.example .env
```

Edit `.env` and set your API key:

```bash
OPENAI_API_KEY=your_key_here
```

The runner loads `javascript-app/.env` through the provided scripts. The web app uses its built-in defaults. Put web overrides in `apps/demo-web/.env.local` or the shell that starts it; Next.js does not load the app-level `.env`.

An `Ignored build scripts` warning for `esbuild` does not require approval for this setup. The supplied dependency versions install and build without that script.

Install the Playwright browser:

```bash
pnpm playwright:install
```

On Linux, install Chromium and its system libraries with:

```bash
pnpm playwright:install:with-deps
```

If Playwright reports missing system libraries, rerun the `with-deps` command and follow its package prompts.

Start the runner and console together:

```bash
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), choose a scenario, keep **Headless** selected, and select **Start Run**. All three scenarios send real API requests. To try drawing, choose **Sketch Studio** and use the supplied prompt.

The console keeps run actions at the top, with controls and activity in separate scrolling panels. Below 960px, use **Controls**, **Preview**, and **Activity** to switch panels. The timeline stays visible; **Show thumbnails** opens the frame strip.

The console reconnects and polls for missed updates. Refreshing the page restores the active run, including **Stop**.

## Local Development

Run the services separately for independent logs, using one terminal for each:

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

`pnpm check` runs lint, type checks, automated tests, and a production build. Lint includes the root labs. The regular tests and paint browser suite use Chromium but make no live API calls.

These commands run from `javascript-app/`. From the repository root, use `pnpm --dir javascript-app <command>`.

Live smoke tests load the same `.env` and send real API requests:

```bash
pnpm test:live
```

After building, start the production services in separate terminals:

```bash
pnpm --filter @cua-sample/runner start
pnpm --filter @cua-sample/demo-web start
```

See [contributing](docs/contributing.md) for the checks and steps to add a scenario.

## Browser Execution

Each run uses a persistent Playwright JavaScript session exposed through `exec_js`. The model controls the browser, and the runner records tool activity, screenshots, and verification results. Choose **Headless** or **Visible** in the console; the API values are `headless` and `headful`.

The main runner owns the API client, HTTP server, run records, execution deadline, and Chromium lifecycle. One child process per run owns the JavaScript context and Playwright page. Use `globalThis` to keep custom state between calls. The worker also provides `page`, `context`, `browser`, `Buffer`, `console.log`, and `display()`.

Ordinary script errors return as tool output so the model can correct them. Stop and the 20-second execution deadline can terminate the worker and Chromium even when JavaScript loops forever. A timeout, worker crash, or invalid worker response fails the run. Cleanup finishes before another run can start.

Follow the [model loop](packages/runner-core/src/responses-loop.ts), [worker](packages/runner-core/src/javascript-worker.ts), and [process controller](packages/browser-runtime/src/javascript-process.ts) to see this flow. The [scenario runtime](packages/runner-core/src/scenario-runtime.ts) connects them to the lab and verification. See [architecture](docs/architecture.md) for more detail.

## API And Replay Changes

Omit `mode` when calling `POST /api/runs`. Requests containing `mode: "code"`, `mode: "native"`, or any other unknown field receive HTTP 400. Run records have no `mode` field, and scenario manifests have no `defaultMode`.

The start response includes initial run detail. `GET /api/runs/active` returns the active run or `null`, which lets the console recover after a page refresh.

Replay bundles use version `2` and include function-call events. The runner writes snapshots atomically and uses `replay.json` as the saved source of truth. Records and screenshots live under `data/runs/<run-id>/`; lab copies live under `data/workspaces/<run-id>/` in this app directory.

Existing saved files remain in place. The app does not migrate old replay paths or display historical native runs.

## Official Scenarios

- `kanban-reprioritize-sprint` (`kanban`): move cards to the columns and order requested in the prompt
- `paint-draw-poster` (`paint`): draw and save artwork in Sketch Studio
- `booking-complete-reservation` (`booking`): find a hotel and complete the requested reservation

Verification is off by default. Enable **Run verification checks** under **Advanced settings**. With verification off, success means the model loop completed; the runner skips outcome checks. For Kanban or Booking verification, replace the freeform default prompt with a [structured example](docs/scenarios.md). The runner checks those fields before the model starts.

See [scenario details](docs/scenarios.md) for prompts and verification rules, and the [shared labs](../README.md#shared-labs) for an overview.

## Sketch Studio

Sketch Studio opens a 1024 × 768 raster document. It supports brushes, pencil, eraser, fill, eyedropper, shapes, text, selections, up to eight layers, undo/redo, and zoom/pan. The model uses the visible controls through the Playwright session.

**Save draft** stores a version-2 record of the artwork and layers in IndexedDB. Reload recovery works within the same lab origin and browser context; a new run starts fresh. **Export PNG** downloads the current artwork without editor chrome and does not save a draft.

When the model finishes normally, the runner retains the last saved draft as `artwork/draft.png` and `artwork/draft.sketch.json` in the run workspace. Capture runs before optional verification, including when verification is off. The activity log records the paths; successful run summaries include them too.

No saved draft means no retained paint files. Invalid image data or file-write errors fail the run. Cancelled or interrupted runs may end before capture.

Paint verification checks that the saved draft is nonblank and matches the current layers and rendered pixels. Review the image yourself to assess whether it depicts the requested subject.

Try: “Draw a yellow smiley face with black eyes and a curved smile, then save the draft.” See the [paint lab guide](../labs/paint-lab-template/README.md) for controls and save behavior. The live paint smoke tests exercise both headless and visible Chromium.

## Repo Map

- `apps/demo-web`
  The operator console
- `apps/runner`
  HTTP routes, event streams, and screenshot serving
- `packages/replay-schema`
  Request, response, replay, and error contracts
- `packages/scenario-kit`
  Scenario manifests and default prompts
- `packages/browser-runtime`
  Chromium lifecycle, worker protocol, and execution deadlines
- `packages/runner-core`
  Run management, Responses loop, execution worker, and verification
- [`../labs`](../labs/)
  Shared templates copied into each run's workspace
- [`docs`](docs/)
  Architecture, scenario, and contribution guides

## Environment Variables

Runner settings belong in `javascript-app/.env` or the runner's shell:

- `OPENAI_API_KEY`: required for all three scenarios
- `HOST`: defaults to `127.0.0.1`
- `PORT`: defaults to `4001`
- `CUA_DEFAULT_MODEL`: defaults to `gpt-5.6-sol`
- `CUA_RESPONSES_MODE`: `auto` uses the API when a key is available outside tests; `live` requires a key; `fallback` disables API calls and cannot run these scenarios
- `CUA_ALLOWED_ORIGINS`: extra browser origins, separated by commas; local console origins on ports 3000 and 3041 are allowed by default

Web settings belong in `apps/demo-web/.env.local` or the web app's shell:

- `RUNNER_BASE_URL`: defaults to `http://127.0.0.1:4001`
- `NEXT_PUBLIC_CUA_DEFAULT_MODEL`: optional override; leave unset to use the runner's default model
- `NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS`: defaults to `24`

See [`.env.example`](.env.example) for the runner template and commented web examples. Restart a service after changing its environment. Rebuild the production web app after changing `NEXT_PUBLIC_*` values.

## Safety And Limitations

Read the [shared safety guidance](../README.md#safety-and-limitations) before running the app.

The worker provides a way to stop execution, not an operating-system security sandbox. It runs with your user permissions and has no filesystem or network isolation. The parent removes `OPENAI_API_KEY` from the worker and Chromium environments; this does not prevent code from reading local files.

This sample focuses on browser tasks in local labs. Keep the runner on its default loopback address for local development.

## Release Validation Checklist

- clone the repository into a fresh directory
- follow this README to install dependencies and start the app
- run `pnpm check` and `pnpm test:paint:browser`
- start the development and production services
- complete one verified headless run and one verified visible run with live credentials
- check that Stop works and an intentional failure gives useful guidance
