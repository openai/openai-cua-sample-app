# Contributing to the Python app

Start with the [quickstart](../README.md#quickstart) and [architecture](architecture.md). Keep lab templates, prompts, task data, and lab-specific tests in the shared `labs/` directory; follow its [contribution guide](../../labs/docs/contributing.md) when changing those.

## Checks

From `python-app/` after setup:

```bash
pnpm check
.venv/bin/python -m unittest discover -s runtimes -p "test_*.py"
```

`pnpm check` runs the TypeScript app's lint, typechecks, tests, and production builds. The second command tests the Python worker and input cleanup with fake desktop inputs. Use `.venv\Scripts\python.exe` on Windows.

Default tests must not operate the host desktop or call the API. App tests cover runtime and console behavior with synthetic scenarios; lab tests and opt-in live runs belong in `labs/`. See [lab checks](../../labs/docs/contributing.md#checks) for integration and live commands.

[Python CI](../../.github/workflows/python-app.yml) runs app checks, Python tests, lab integration, and a production startup check on Linux with Python 3.12.

## Development and production startup

Use `pnpm dev` to start both services. For separate logs, run `pnpm dev:runner` and `pnpm dev:web` in separate terminals.

To test a production build:

```bash
pnpm build
```

Then start each service in a separate terminal:

```bash
pnpm --filter @cua-sample/runner start
pnpm --filter @cua-sample/demo-web start
```

The runner uses port **4041** and the console uses **3041**, as in development. Runner and web configuration are described in the [README](../README.md#configuration).

For desktop runtime changes, also try the quickstart, Stop, and failsafe on a dedicated desktop. Describe the checks and operating systems exercised in the pull request.
