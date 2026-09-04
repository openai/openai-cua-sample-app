# Python app architecture

Read the [README](../README.md#code-walkthrough), then follow the model loop, execution worker, and supporting modules below. The shared console calls the native Python/FastAPI backend; Python owns the API client, run lifecycle, browser management, and persisted output.

## Model loop

1. `POST /api/runs` validates settings, reserves the active-run slot, and prepares a fresh lab workspace.
2. [`run_responses_code_loop`](../app/responses_loop.py) sends the prompt and `exec_py` function tool to the Responses API through the Python SDK.
3. It validates the response, sends each requested code block to the Python worker, and collects text/images.
4. It sends those results as `function_call_output` with the matching `call_id`, using `previous_response_id` to continue the conversation. Commentary continues the loop. A final answer completes it when no tool calls remain; exhausting the turn budget fails the run.
5. The scenario captures the final browser state. The runner publishes the terminal status after cleanup and persistence, then releases its active-run slot.

## Execution worker

[`desktop/worker.py`](../app/desktop/worker.py) executes Python with `pyautogui`, `log()`, and `display()` available. Its globals persist between calls; each new run starts a fresh worker. [`desktop/runtime.py`](../app/desktop/runtime.py) exchanges line-delimited JSON with the worker and enforces execution deadlines.

Ordinary Python errors return to the model. Each call has a 60-second deadline. Timeout, failsafe, worker failure, and Stop terminate execution and trigger input cleanup. The worker is not an operating-system security sandbox.

PyAutoGUI drives the real mouse and keyboard. Python Playwright starts the visible Chromium session and collects browser previews. Model code receives PyAutoGUI, not a Playwright page. Native screenshots are normalized to mouse-input coordinates, including on Retina displays; artifacts identify their source and image dimensions.

## Supporting modules

| Location | Responsibility |
| --- | --- |
| [`api.py`](../app/api.py) | FastAPI routes, capabilities, event streams, and artifact serving. |
| [`runner.py`](../app/runner.py) | Active-run admission, lifecycle, cancellation, event publication, and persistence. |
| [`browser.py`](../app/browser.py) and [`scenario_runtime.py`](../app/scenario_runtime.py) | Chromium, local lab server, execution worker, and final screenshots. |
| [`lab_catalog.py`](../app/lab_catalog.py) | Read the shared catalog and add Python tool instructions. |
| [`desktop`](../app/desktop/) | Persistent execution process and desktop-input cleanup. |
| [`storage.py`](../app/storage.py) and [`models.py`](../app/models.py) | Atomic run storage and Python wire validation. |
| [`console`](../../console/) | Shared run controls, activity, and screenshot review. |
| [`contracts`](../../contracts/) | Shared wire contract and cross-language fixtures. |
| [`labs`](../../labs/) | The three shared labs: Kanban, Paint, and Booking, with templates, task data, guides, and tests. |

## HTTP and saved output

The [shared contract](../../contracts/index.ts) accepts `scenarioId`, `prompt`, and optional `model`, `browserMode`, and `maxResponseTurns`. Unknown request fields receive HTTP 400. Python requires `headful`: omitting `browserMode` defaults to it, and `headless` is rejected.

Both backends expose the same routes:

- `GET /health` and `GET /api/capabilities`
- `GET /api/scenarios` and `POST /api/scenarios/:id/reset`
- `POST /api/runs` and `GET /api/runs/active`
- `GET /api/runs/:id` and `POST /api/runs/:id/stop`
- `GET /api/runs/:id/events` and `GET /api/runs/:id/replay`
- `GET /api/runs/:id/artifacts/screenshots/:name`

The capabilities response identifies Python, `exec_py`, visible browser mode, and defaults. The shared console is fixed to the backend selected by the root launch command. Its JSON requests carry `X-CUA-Backend`; a mismatch receives HTTP 409 before an action is executed.

The start response includes initial run detail. The console combines SSE events with bounded detail polling and can reconnect to an active run after a page refresh. It reconciles a lost Start response through active-run lookup without automatically resending Start.

Version-3 replay bundles contain run/scenario records, events, screenshot references, and a summary. Saved replay data lives at `python-app/data/runs/<run-id>/replay.json`; workspaces live at `python-app/data/workspaces/<run-id>/`. The backend keeps these files after a run finishes.

A `completed` status means the agent loop, screenshot and trace persistence, and cleanup finished normally. The summary contains notes and counts, not a task-success grade. The console labels this **Run finished**.

Older replay versions are left on disk unchanged. Loading one returns HTTP 409 with `unsupported_replay_version`; no migration is performed. Paint Save Draft keeps its separate version-2 format in browser storage; the backend does not export artwork files. After updating, restart the selected backend and console and refresh the page.

[`__main__.py`](../app/__main__.py) starts one Uvicorn server and holds the exclusive **127.0.0.1:4050** lease through shutdown. It does not start a Node.js backend. Cleanup stops the worker, releases inputs, and closes Chromium and the lab server before terminal publication. A cleanup failure blocks further desktop runs until the operator resolves it and restarts the runner. See [contributing](contributing.md) for development and checks.
