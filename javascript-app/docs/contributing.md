# Contributing to the JavaScript backend

Follow the [quickstart](../README.md#quickstart). All commands below run from the repository root; The JavaScript backend, the shared console, contracts, and lab tests use one pnpm workspace and lockfile.

## Development and checks

```bash
pnpm dev:js
pnpm check:js
```

`check:js` runs lint, typechecks, JavaScript and console tests, contract fixtures, and a production build. `check:labs` runs shared lab engine and browser integration tests. These checks do not call the live API or control the host desktop.

Useful focused commands:

```bash
pnpm --filter @cua-sample/runner test
pnpm --filter @cua-sample/console test
pnpm check:labs
```

Run `pnpm check` after installing Python dependencies and both browser distributions to check both backends and shared labs. [CI](../../.github/workflows/samples.yml) uses one root install, runs ordinary checks with no API key, and smoke-tests production startup with JavaScript followed by Python.

## Production and shutdown

```bash
pnpm build
pnpm start:js
```

The runner uses **4001** and the shared console **3000** by default. Configuration is the same as development. Use **Ctrl+C** and wait for cleanup before launching Python. Both backend entrypoints hold the exclusive **4050** lease, including when started outside the root launcher. Bare `pnpm dev` prints the supported launch choices; it does not start both backends.

## Live checks

After configuring `.env` and installing Chromium, explicitly run:

```bash
pnpm --filter cua-sample-labs test:live
```

This suite calls the real Responses API and exercises the shared labs. It is excluded from ordinary CI. For browser/lifecycle changes, also start `pnpm dev:js`, complete each of the three [lab tasks](../../labs/docs/scenarios.md), and try Stop in headless and visible modes. Describe which checks and operating systems you actually exercised in the pull request.

## Where to make changes

- Model/tool interaction lives in [`responses-loop.ts`](../src/responses-loop.ts); the [architecture map](architecture.md#supporting-modules) locates lifecycle and worker code.
- Shared UI changes belong in [`console`](../../console/), with capability-specific controls and regression tests for both backends.
- Public wire changes belong in [`contracts`](../../contracts/). Update matching Python models and fixtures, then run `pnpm --filter @cua-sample/contracts test` and `pnpm check:python`.
- Lab prompts, templates, task examples, and automated lab checks follow the [lab contribution guide](../../labs/docs/contributing.md).

Keep app-unit tests synthetic. Lab-specific integration tests belong under `labs/tests/`; native Python parity tests belong under `python-app/tests/`.
