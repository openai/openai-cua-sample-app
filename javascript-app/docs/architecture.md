# JavaScript app architecture

The JavaScript sample is a pnpm workspace under `javascript-app/`. The runner copies a shared root `labs/` template into a fresh workspace for each run.

## Process boundary

The main runner owns the Responses API client, HTTP/SSE server, run records, request deadlines, and Chromium browser-server handle. A child Node.js process connects to Chromium and owns the Playwright context, page, persistent JavaScript globals, and scenario verification.

The worker provides a separate process that the parent can terminate. It is **not an operating-system security sandbox** and runs with the host user's permissions. The parent removes `OPENAI_API_KEY` from the worker and Chromium environments; this does not provide filesystem or network isolation. The HTTP runner binds to loopback by default and has no authentication.

An internal [protocol](../packages/browser-runtime/src/protocol.ts) carries initialization, JavaScript execution, browser observations, screenshots, finalization, and close requests. The parent does not expose the full Playwright API over that protocol.

## Package boundaries

| Location | Responsibility |
| --- | --- |
| [`packages/replay-schema`](../packages/replay-schema/src/index.ts) | Request, response, event, and replay contracts used by the app. |
| [`packages/scenario-kit`](../packages/scenario-kit/src/scenarios.ts) | Scenario registry, template locations, and default prompts. |
| [`packages/browser-runtime`](../packages/browser-runtime/src/javascript-process.ts) | Chromium and worker lifecycle, protocol validation, observations, and deadlines. |
| [`packages/runner-core`](../packages/runner-core/src/runner-manager.ts) | Run lifecycle, workspaces, model loop, scenario executors, and verification. |
| [`apps/runner`](../apps/runner/src/server.ts) | Fastify routes, SSE, and screenshot serving. |
| [`apps/demo-web`](../apps/demo-web/app/ui/operator-console/useRunStream.ts) | Console state, run actions, connection recovery, and replay presentation. |

## A run from start to finish

1. The console loads scenarios and checks for an active run. A page refresh can reattach to that run.
2. `POST /api/runs` validates the request. `RunnerManager` reserves the single active-run slot, copies the lab template, and creates the initial run and replay records.
3. The scenario executor starts a local lab server, parent-owned Chromium, and a JavaScript worker.
4. The [Responses loop](../packages/runner-core/src/responses-loop.ts) exposes `exec_js` and sends requested code to the worker. It returns tool output to the model and records tool-call events and screenshots.
5. Commentary continues the loop. A final assistant message with no pending tool calls completes it. API failure states, unsupported tools, and an exhausted turn budget fail the run.
6. The worker's `finalizeScenario` handler retains scenario artifacts and runs verification when enabled.
7. The parent awaits cleanup of the worker, Chromium, and lab server, then publishes the terminal run status and releases the active-run slot. Replay snapshots are written atomically.

The start response includes initial run detail. The console follows SSE and polls every two seconds to recover missed updates. Requests have client-side deadlines so an unavailable runner does not leave an action pending indefinitely. `GET /api/runs/active` returns the active `RunDetail` or `null`; it does not provide completed-run history. Persisted runs remain available through their detail and replay endpoints. Their event endpoint also works after completion, failure, or cancellation.

## JavaScript execution and cleanup

The worker exposes `browser`, `context`, `page`, `Buffer`, `console.log`, and `display()`. Each tool call runs in an async function, so use `globalThis` to retain custom state between calls. A new run gets fresh JavaScript and browser state.

The parent starts a 20-second deadline before sending a JavaScript request. Ordinary script exceptions return as tool output, allowing the model to correct them. Playwright actions default to a 10-second timeout and navigation to 15 seconds.

Stop, execution timeout, worker failure, or an invalid worker response ends the session and awaits process cleanup. The watchdog and browser handle remain in the parent, so synchronous loops, loops after `await`, and unresolved promises in the worker can be terminated. Stop and runner shutdown tolerate repeated calls.

## HTTP and replay contracts

The [shared schema](../packages/replay-schema/src/index.ts) defines accepted start fields: `scenarioId`, `prompt`, optional `model`, `browserMode`, `maxResponseTurns`, and `verificationEnabled`. Unknown fields receive HTTP 400. Browser visibility uses `headless` or `headful`.

The main endpoints are:

- `GET /api/scenarios` and `POST /api/scenarios/:id/reset`
- `POST /api/runs` and `GET /api/runs/active`
- `GET /api/runs/:id` and `POST /api/runs/:id/stop`
- `GET /api/runs/:id/events` and `GET /api/runs/:id/replay`
- `GET /api/runs/:id/artifacts/screenshots/:name`

Version-2 replay bundles contain the run record, workspace reference, screenshot references, summary, and ordered events, including function calls. Files live under `javascript-app/data/`.

`replay.json` is the authoritative snapshot. An interrupted write can leave the separate run record or event log ahead of it.

The console fills the viewport, with independent scrolling for controls and activity. On narrow screens, Controls, Preview, and Activity navigation preserves panel state. The timeline remains available with thumbnails collapsed, and reviewing older activity or a selected frame preserves that position as new events arrive.

See [contributing](contributing.md) for extension points.
