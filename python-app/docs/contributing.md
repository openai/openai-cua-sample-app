# Contributing to the Python backend

Follow the [quickstart](../README.md#quickstart) and [architecture guide](architecture.md). All commands below run from the repository root. Python dependencies are locked in `python-app/uv.lock`; JavaScript dependencies for the shared console, contracts, and labs use the root pnpm workspace.

## Development and checks

```bash
pnpm python:install
pnpm dev:python
```

The launcher invokes `python-app/.venv`'s interpreter directly. The native Python process owns FastAPI, the Responses loop, browser management, worker, and persistence.

Ordinary checks:

```bash
pnpm check:python
pnpm --filter @cua-sample/console test
pnpm check:labs
```

`check:python` runs Ruff, mypy, and pytest. Tests use fake model/desktop inputs or safe subprocess fixtures. Shared fixtures verify agreement between the TypeScript/Zod and Python/Pydantic contracts. No ordinary test may issue real mouse/keyboard actions or call the live API.

Install Python's Chromium and opt into headless browser tests of all three labs:

```bash
pnpm python:playwright:install
CUA_BROWSER_TESTS=1 uv run --project python-app pytest python-app/tests/test_browser_labs.py
```

These tests use headless Chromium to inspect lab state and do not use PyAutoGUI input. [CI](../../.github/workflows/samples.yml) enables this check after installing the Python Playwright browser. Run `pnpm check` to check both backends, the shared console, and shared labs.

## Production and shutdown

```bash
pnpm build
pnpm start:python
```

The native runner uses **4041** and the shared console **3000** by default, with the same configuration as development. Use the supported single-process entrypoint rather than Uvicorn reload or multiple workers. The backend holds the exclusive **127.0.0.1:4050** lease until its cleanup finishes.

Use **Ctrl+C** and wait for shutdown before starting JavaScript. Exercise **Stop**, failsafe interruption, and recovery on a dedicated desktop when changing runtime code. A released lease after a crash does not establish that desktop inputs were released; follow the [recovery guidance](../README.md#interruption-and-recovery).

## Live checks

After completing desktop permissions, setting an API key in `.env`, and installing Chromium, explicitly run:

```bash
CUA_LIVE_TESTS=1 uv run --project python-app pytest python-app/tests/test_live_labs.py -m live
```

The live suite operates the real desktop and calls the Responses API for the three shared labs. Use a dedicated session, keep the lab window in front, and avoid other mouse/keyboard activity. Live tests are skipped without explicit opt-in and excluded from ordinary CI.

For a manual check, launch `pnpm dev:python` and run each of the three [lab tasks](../../labs/docs/scenarios.md). Inspect the screenshots and model response to judge the result. Check screenshot coordinates, Stop, and failsafe behavior. State which checks and operating systems you actually exercised in the pull request.

## Where to make changes

- Model/tool interaction lives in [`responses_loop.py`](../app/responses_loop.py); desktop execution and cleanup live under [`desktop`](../app/desktop/).
- HTTP and persistence behavior follow the [architecture map](architecture.md#supporting-modules). Preserve the shared route shapes, admission semantics, and terminal-after-cleanup lifecycle.
- Wire changes belong in [`contracts`](../../contracts/), with matching Python models and fixtures. Run `pnpm --filter @cua-sample/contracts test` and `pnpm check:python` to validate both implementations against the shared fixtures.
- Shared UI changes belong in [`console`](../../console/). Lab prompts, templates, task examples, and automated lab checks follow the [lab contribution guide](../../labs/docs/contributing.md).
