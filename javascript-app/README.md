# JavaScript + Playwright sample app

Connect the Responses API to Playwright and watch a model work in the browser. Start a task in the console, then follow its actions, screenshots, and results.

The model's code runs with your permissions. A separate process lets **Stop** end it. This is not a security sandbox. Use local labs or other environments you control.

## First run

Use Node.js **22.20.0** (pinned in [`.node-version`](.node-version)) and pnpm **10.26.0** (pinned in [`package.json`](package.json)).

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app/javascript-app
corepack enable
pnpm install
cp .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY`. Your key must have access to the model in `CUA_DEFAULT_MODEL`, which defaults to `gpt-5.6-sol`. The runner scripts load this file for you. All three scenarios send real API requests.

Install Chromium and start the app. On Linux, replace `pnpm playwright:install` with `pnpm playwright:install:with-deps` to include system libraries.

```bash
pnpm playwright:install
pnpm dev
```

Open [the console](http://127.0.0.1:3000). Choose **Sketch Studio**, keep **Headless**, and use the supplied drawing prompt. To check the saved draft, enable **Verification** in the advanced controls. Select **Start Run**.

Watch the activity and screenshots as the model works. The console recovers missed updates; refreshing the page reconnects to the active run. **Stop** ends the run and waits for the worker and browser to close. For a later run, choose **Visible** to watch Chromium in a separate window.

## Configuration

The runner loads `javascript-app/.env`. Set `CUA_DEFAULT_MODEL` to change its default model. The console uses this default unless you set a web override.

| Runner variable | Default / purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required. The key must have access to the configured model. |
| `CUA_DEFAULT_MODEL` | `gpt-5.6-sol`. |
| `HOST` | `127.0.0.1`. |
| `PORT` | `4001`. |
| `CUA_RESPONSES_MODE` | `auto` (default) calls the API with a key outside tests. `live` requires a key. `fallback` disables API calls, so these labs cannot run. |
| `CUA_ALLOWED_ORIGINS` | Extra browser origins, separated by commas. Local console origins on ports 3000 and 3041 are already allowed. |

Put web overrides in `apps/demo-web/.env.local` or the shell that starts the web app. Next.js does not load `javascript-app/.env`.

| Web variable | Default / purpose |
| --- | --- |
| `RUNNER_BASE_URL` | `http://127.0.0.1:4001`. Change it if the runner address changes. |
| `NEXT_PUBLIC_CUA_DEFAULT_MODEL` | Overrides the runner's default model. Leave unset to use `CUA_DEFAULT_MODEL`. |
| `NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS` | `24`. |

See [`.env.example`](.env.example) for the runner settings and commented web examples. Restart a service after changing its environment. For production, rebuild the web app after changing `NEXT_PUBLIC_*` values.

## Scenarios and results

| Scenario | Task | Optional verification |
| --- | --- | --- |
| Launch Planner | Move Kanban cards. | Checks each card's column and order. |
| Sketch Studio | Draw with brushes, shapes, text, selections, and layers. | Checks that the saved draft is nonblank and matches the current document and pixels. |
| Northstar Stays | Complete a local hotel reservation. | Checks the filters and confirmation. |

Verification is off by default. With it off, success means the model loop completed; the runner skips outcome checks. For Kanban or Booking verification, replace the freeform default prompt with a [structured example](docs/scenarios.md). The runner checks those fields before the model starts.

Each run starts from a fresh copy of a root lab template. The runner saves records, replay JSON, and screenshots under `data/runs/<run-id>/`. Lab copies live under `data/workspaces/<run-id>/`.

In Sketch Studio, **Save draft** stores the artwork and layers in IndexedDB. When the model finishes normally, the runner writes the last saved draft to `artwork/draft.png` and `artwork/draft.sketch.json` in the run workspace. It does this even with verification off.

**Export PNG** downloads the current artwork and does not save a draft. Without a saved draft, there are no paint files to retain. A cancelled run may end before capture. See [scenario details](docs/scenarios.md) and the [paint lab guide](../labs/paint-lab-template/README.md).

## Read the code

Follow a task through these files:

1. [`responses-loop.ts`](packages/runner-core/src/responses-loop.ts) sends API requests, handles `exec_js` tool calls, and reads the final response.
2. [`javascript-worker.ts`](packages/runner-core/src/javascript-worker.ts) runs the code, keeps JavaScript state between calls, and finalizes the scenario.
3. [`javascript-process.ts`](packages/browser-runtime/src/javascript-process.ts) starts the worker, enforces deadlines, and closes Chromium.
4. [`scenario-runtime.ts`](packages/runner-core/src/scenario-runtime.ts) connects the lab, model loop, screenshots, and verification.

See [architecture](docs/architecture.md) for more detail or [contributing](docs/contributing.md) to add a scenario.

## Development and checks

Run these commands from `javascript-app/`. From the repository root, use `pnpm --dir javascript-app <command>`.

For separate logs, start each service in its own terminal:

```bash
pnpm dev:runner
pnpm dev:web
```

Run the checks:

```bash
pnpm check
pnpm test:paint:browser
```

`pnpm check` runs lint, type checks, automated tests, and a production build. You can also run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` separately. Lint includes the shared root labs.

Live smoke tests load the same `.env` and send real API requests:

```bash
pnpm test:live
```

After `pnpm build`, start each production service in its own terminal:

```bash
pnpm --filter @cua-sample/runner start
pnpm --filter @cua-sample/demo-web start
```

If something goes wrong:

- **Runner unavailable:** Check the runner terminal and its address.
- **Chromium missing:** Rerun the Playwright install command above.
- **Execution timeout:** Review the activity and start a new run. The timed-out worker is discarded.
