# Python app architecture

The TypeScript app owns the Responses API loop, browser, and console. A persistent Python worker executes the model's PyAutoGUI code. Shared lab definitions and templates live in the sibling `labs/` directory.

## File map

| Path | Responsibility |
| --- | --- |
| `apps/demo-web/` | Console controls, run events, and screenshot review. |
| `apps/runner/` | Fastify HTTP API and artifact serving. |
| `packages/runner-core/` | Run lifecycle, Responses loop, and verification adapters. |
| `packages/browser-runtime/` | Chromium lifecycle and the Python process connection. |
| `packages/scenario-kit/` | Shared lab catalog and template paths. |
| `packages/replay-schema/` | Request, event, and replay contracts. |
| `runtimes/` | Python execution and desktop input cleanup. |

## Run lifecycle

1. The runner validates the request and copies the selected lab into a fresh workspace under `data/`. One run can be active at a time.
2. The scenario executor starts a local lab server, Python worker, and visible Chromium window.
3. The [Responses loop](../packages/runner-core/src/responses-loop.ts) calls the model with the prompt and a custom function tool named `exec_py`. The [Python connection](../packages/browser-runtime/src/python-runtime.ts) sends requested code to the [worker](../runtimes/python-worker.py) as line-delimited JSON.
4. Text and images return as `function_call_output` with the matching `call_id`. The runner uses `previous_response_id` to continue the conversation. A final answer ends the loop; exhausting the turn budget fails the run.
5. The executor retains supported artifacts and runs optional verification. The [lab guide](../../labs/docs/README.md) explains what each check verifies.
6. The runner stops the worker, releases desktop input, and closes the browser and lab server before publishing the final status.

Python globals survive between tool calls. Ordinary exceptions return to the model as output; a failsafe, execution timeout, or worker failure ends execution. If input cleanup fails, the operator must check held inputs and desktop permissions, then restart the runner.

The app records tool events, desktop images returned by Python, and browser previews. Desktop screenshots are normalized to PyAutoGUI's input coordinates. The console receives events through SSE and polls run detail to stay current; refreshing reconnects to an active run.

## API and replay contracts

The [HTTP server](../apps/runner/src/server.ts) provides scenario listing/reset, run start/detail/stop, active-run lookup, SSE events, replay bundles, and screenshot artifacts. Their public shapes live in [replay-schema](../packages/replay-schema/src/index.ts).

Start requests specify the scenario and prompt, with optional model, turn budget, and verification settings. Python requires a visible browser: omitted `browserMode` defaults to `headful`, and `headless` is rejected. `exec_py` is the only model tool.

Run data and replay bundles are saved under `data/`; replay bundles use version 2. Lab templates remain unchanged because each run operates on its own copy.

See [contributing](contributing.md) for checks and the [shared lab contribution guide](../../labs/docs/contributing.md) for lab changes.
