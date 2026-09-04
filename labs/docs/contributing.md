# Contributing to the shared labs

Lab templates, catalog data, documentation, and shared browser tests live here. Runtime setup and run recording live in each backend. `tests/shared/` covers the lab UI and editor, `tests/integration/` covers the JavaScript runner, and `tests/live/` contains the opt-in API smoke test. Native Python integration tests live in `python-app/tests/` and use pytest.

## Add or update a lab

1. Edit `labs/<name>-lab-template/`. Keep assets local and the initial state readable from screenshots.
2. Update [catalog.json](../catalog.json) with the manifest, default prompt, and instructions.
3. Update the JavaScript executor mapping and both backends' setup as needed. Catalog access lives in [`javascript-app/src/lab-catalog.ts`](../../javascript-app/src/lab-catalog.ts) and [`python-app/app/lab_catalog.py`](../../python-app/app/lab_catalog.py). Update shared lab enums in `contracts`, matching Python models, and cross-language fixtures. Capture final screenshots before browser cleanup.
4. Update the [task guide](scenarios.md) and [lab index](README.md). Put shared browser tests in `labs/tests/shared/`, JavaScript integration tests in `labs/tests/integration/`, and Python parity tests in `python-app/tests/`.

Automated lab tests should assert concrete UI and saved-data behavior against explicit fixtures. Keep these assertions in test code. Runtime prompts use ordinary language, and a finished run does not certify task success.

## Checks

Install the root workspace once, then run the shared browser and JavaScript integration checks:

```bash
pnpm install --frozen-lockfile
pnpm playwright:install
pnpm check:labs
```

On Linux, use `pnpm playwright:install:with-deps` to include system libraries. Native Python lab tests use Python's pinned Playwright browser:

```bash
pnpm python:install
pnpm python:playwright:install
CUA_BROWSER_TESTS=1 uv run --project python-app pytest python-app/tests/test_browser_labs.py
```

For shared lab changes, run both backend integration suites and the shared tests. These checks need no API key and do not control the host desktop. `pnpm check:python` runs the full native Python suite; `pnpm check` combines all main check groups.

## Opt-in live runs

Live tests load the root `.env` and call the OpenAI API. Complete that backend's browser/desktop setup first, stop any running sample launch, then explicitly run one suite:

```bash
pnpm --filter cua-sample-labs test:live
CUA_LIVE_TESTS=1 uv run --project python-app pytest python-app/tests/test_live_labs.py -m live
```

Python live tests control the real mouse and keyboard. Use a dedicated graphical session and keep the lab window in front. Live tests are excluded from ordinary checks and CI.

For a manual pass, start `pnpm dev:js` or `pnpm dev:python` from the repository root. Run all three tasks from the [task guide](scenarios.md). Inspect the model response, screenshots, and Replay JSON; try Stop. Report the actual commands and desktop environments you exercised.
