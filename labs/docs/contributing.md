# Contributing to the shared labs

Lab templates, catalog data, documentation, and lab-specific tests live here. Runtime adapters live in each app.

## Add or update a lab

1. Edit `labs/<name>-lab-template/`. Keep assets local and make the initial state readable from screenshots.
2. Update [catalog.json](../catalog.json) with the manifest, default prompt, instructions, and verifier data. Keep hotel and card definitions in the template's `app.js` aligned with the catalog.
3. For a new lab, connect each app's scenario adapter and executor registry, and extend its `replay-schema` enums as needed. Add the scenario to the JavaScript worker's `finalizeScenario`; Python finalization lives in the executor. Keep artifact retention before optional verification and browser cleanup.
4. Update the [task guide](scenarios.md) and [lab index](README.md). Put lab tests in `tests/shared/` and app integration tests in `tests/integration/javascript/` or `tests/integration/python/`.

Verification should read final state through stable, read-only browser accessors. Validate structured prompts before model execution and document what a passing check means.

## Checks

From the repository root, install the independent lab test package and run its lint and shared browser tests:

```bash
pnpm --dir labs install --frozen-lockfile
pnpm --dir labs playwright:install
pnpm --dir labs check
```

On Linux, replace `playwright:install` with `playwright:install:with-deps` to include system libraries. After installing the relevant app's dependencies, run its integration suite:

```bash
pnpm --dir labs test:javascript
pnpm --dir labs test:python
```

For shared lab changes, run all three suites. These checks need no API key and do not control the host desktop.

Live tests load the relevant app's `.env` and call the OpenAI API. Follow that app's browser/desktop setup first, then run:

```bash
pnpm --dir labs test:live:javascript
pnpm --dir labs test:live:python
```

Python live tests control the real mouse and keyboard. Live tests are excluded from ordinary checks and CI.
