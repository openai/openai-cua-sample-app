# JavaScript app architecture

The console calls a local Fastify runner. For each run, the runner copies a shared lab template, starts Chromium, and launches a Node.js worker. The runner owns the API client and run records; the worker owns the Playwright page and persistent JavaScript context.

## The model loop

1. `POST /api/runs` validates the prompt and settings, reserves the single active-run slot, and prepares the lab workspace.
2. The [Responses loop](../packages/runner-core/src/responses-loop.ts) sends the prompt with a custom function tool named `exec_js`.
3. When the model returns a function call, the runner sends its JavaScript to the [worker](../packages/runner-core/src/javascript-worker.ts). The worker executes it and returns text and any images produced by `display()`.
4. The runner sends that output back as `function_call_output` with the matching `call_id`. It uses `previous_response_id` to continue the conversation. Commentary continues the loop; a final answer completes it when no tool calls remain.
5. The worker retains scenario artifacts and runs verification when enabled. The runner waits for cleanup, saves the terminal result, and releases the run slot.

The worker exposes `page`, `context`, `browser`, `Buffer`, `console.log`, and `display(base64Image)`. Each call runs in an async function; use `globalThis` to preserve custom state between calls. New runs start with fresh JavaScript and browser state.

Ordinary script errors return to the model so it can correct them. Each execution call has a 20-second deadline. The separate worker process lets Stop terminate blocked JavaScript; it is not an operating-system security sandbox.

## Code map

| Location | Responsibility |
| --- | --- |
| [`apps/demo-web`](../apps/demo-web/app/ui/operator-console/OperatorConsole.tsx) | Console, run controls, activity, and screenshots. |
| [`apps/runner`](../apps/runner/src/server.ts) | HTTP routes and event streams. |
| [`packages/runner-core`](../packages/runner-core/src/runner-manager.ts) | Run lifecycle, Responses loop, worker, and verification adapters. |
| [`packages/browser-runtime`](../packages/browser-runtime/src/javascript-process.ts) | Chromium and worker process lifecycle. |
| [`packages/scenario-kit`](../packages/scenario-kit/src/scenarios.ts) | Load the shared lab catalog and resolve templates. |
| [`packages/replay-schema`](../packages/replay-schema/src/index.ts) | Request, response, event, and replay contracts. |
| [`labs`](../../labs/) | Shared templates, prompts, task data, and lab-specific tests. |

## HTTP and saved output

The [request schema](../packages/replay-schema/src/index.ts) accepts `scenarioId`, `prompt`, and optional `model`, `browserMode`, `maxResponseTurns`, and `verificationEnabled`. Unknown fields receive HTTP 400. Browser modes are `headless` and `headful`.

- `GET /api/scenarios` and `POST /api/scenarios/:id/reset`
- `POST /api/runs` and `GET /api/runs/active`
- `GET /api/runs/:id` and `POST /api/runs/:id/stop`
- `GET /api/runs/:id/events` and `GET /api/runs/:id/replay`
- `GET /api/runs/:id/artifacts/screenshots/:name`

The start response includes initial run detail. The console follows the event stream and polls for updates; reloading can restore an active run. Completed runs remain accessible by ID through the detail and replay endpoints.

Version-2 replay bundles contain the run, scenario, events, screenshot references, and summary. `data/runs/<run-id>/replay.json` is the saved source of truth. Lab copies live under `data/workspaces/<run-id>/`.

See [contributing](contributing.md) for changes and checks.
