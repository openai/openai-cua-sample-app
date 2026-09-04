# JavaScript app architecture

Read the [README](../README.md#code-walkthrough), then follow the model loop, execution worker, and supporting modules below. The shared console calls the local TypeScript/Fastify backend; the backend owns the API client, run lifecycle, and persisted output.

## Model loop

1. `POST /api/runs` validates settings, reserves the active-run slot, and prepares a fresh lab workspace.
2. [`runResponsesCodeLoop`](../src/responses-loop.ts) sends the prompt and `exec_js` function tool to the Responses API.
3. It validates the response, sends each requested code block to the JavaScript worker, and collects text/images.
4. It sends those results as `function_call_output` with the matching `call_id`, using `previous_response_id` to continue the conversation. Commentary continues the loop. A final answer completes it when no tool calls remain; exhausting the turn budget fails the run.
5. The runner captures the final browser state. The runner publishes the terminal status after cleanup and persistence, then releases its active-run slot.

## Execution worker

[`javascript-worker.ts`](../src/javascript-worker.ts) owns the Playwright session and execution context. It exposes `page`, `context`, `browser`, `Buffer`, `console.log`, and `display(base64Image)`. Each code block runs in an async function; use `globalThis` to retain custom state between calls. Each new run starts with fresh browser and JavaScript state.

Ordinary script errors return to the model. Each call has a 60-second deadline. Stop can terminate blocked code through the separate worker process, then close Chromium and the lab server. The worker is not an operating-system security sandbox.

## Supporting modules

| Location | Responsibility |
| --- | --- |
| [`src/server.ts`](../src/server.ts) | Fastify routes, capabilities, event streams, and artifact serving. |
| [`src/runner-manager.ts`](../src/runner-manager.ts) | Single active run, cancellation, event publication, and persisted output. |
| [`src/browser/`](../src/browser/javascript-process.ts) | Chromium and worker process lifecycle. |
| [`src/lab-catalog.ts`](../src/lab-catalog.ts) | Shared lab catalog access. |
| [`src/executor-registry.ts`](../src/executor-registry.ts) | Select lab instructions and run the shared model/browser flow. |
| [`console`](../../console/) | Shared run controls, activity, and screenshot review. |
| [`contracts`](../../contracts/) | Shared TypeScript/Zod wire contracts and cross-language fixtures. |
| [`labs`](../../labs/) | The three shared labs: Kanban, Paint, and Booking, with templates, task data, guides, and tests. |

## HTTP and saved output

The [shared contract](../../contracts/index.ts) accepts `scenarioId`, `prompt`, and optional `model`, `browserMode`, and `maxResponseTurns`. Unknown request fields receive HTTP 400. JavaScript supports `headless` and `headful` browser modes.

Both backends expose the same routes:

- `GET /health` and `GET /api/capabilities`
- `GET /api/scenarios` and `POST /api/scenarios/:id/reset`
- `POST /api/runs` and `GET /api/runs/active`
- `GET /api/runs/:id` and `POST /api/runs/:id/stop`
- `GET /api/runs/:id/events` and `GET /api/runs/:id/replay`
- `GET /api/runs/:id/artifacts/screenshots/:name`

The capabilities response identifies JavaScript, `exec_js`, supported browser modes, and defaults. The shared console is fixed to the backend selected by the root launch command. Its JSON requests carry `X-CUA-Backend`; a mismatch receives HTTP 409 before an action is executed.

The start response includes initial run detail. The console combines SSE events with bounded detail polling and can reconnect to an active run after a page refresh. It reconciles a lost Start response through active-run lookup without automatically resending Start.

Version-3 replay bundles contain run/scenario records, events, screenshot references, and a summary. Saved replay data lives at `javascript-app/data/runs/<run-id>/replay.json`; workspaces live at `javascript-app/data/workspaces/<run-id>/`. The backend keeps these files after a run finishes. Reset stops an active run for the selected scenario and clears the console; the next Start copies a fresh template.

A `completed` status means the agent loop and cleanup finished normally. The summary contains notes and counts, not a task-success grade. The console labels this **Run finished**.

Older replay versions are left on disk unchanged. Loading one returns HTTP 409 with `unsupported_replay_version`; no migration is performed. Paint drafts use a separate version-2 format in browser storage. After updating, restart the selected backend and console and refresh the page.

The runner holds the shared **127.0.0.1:4050** lease throughout its lifetime, including shutdown. Only one JavaScript or Python backend may run at a time. See [contributing](contributing.md) for development and checks.
