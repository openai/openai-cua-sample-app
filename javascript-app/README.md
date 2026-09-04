# JavaScript / Playwright sample app

A computer-use sample with the Responses API. The model calls `exec_js` to execute JavaScript in a persistent Playwright browser session. A TypeScript runner manages execution, and a Next.js console shows activity and screenshots.

## First run

You need Node.js **22.20.0**, pnpm **10.26.0**, and an API key with access to the model configured in [`.env.example`](.env.example).

[Clone the repository](../README.md#first-run), then run from its root:

```bash
cd javascript-app
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

Edit `.env` and set your API key:

```bash
OPENAI_API_KEY=your_key_here
```

Install Chromium:

```bash
pnpm playwright:install
```

On Linux, use `pnpm playwright:install:with-deps` to install Chromium's system libraries too.

Start the runner and console:

```bash
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), choose a scenario, edit its prompt if needed, and select **Start Run**. The default is **Headless**; choose **Visible** under **Advanced settings** to watch Chromium. Runs send real API requests.

Review screenshots and activity in the console. **Stop** ends the run. Refreshing the page restores an active run.

Verification is off by default. To enable it, select **Run verification checks** under **Advanced settings**. Kanban and Booking require the structured prompts in the [lab task guide](../labs/docs/scenarios.md); the supplied freeform prompts work with verification off. The guide explains what each check verifies.

## Configuration

Runner settings belong in `.env` or the runner's shell. The provided development and production scripts load `.env`; shell variables take precedence. See [`.env.example`](.env.example) for runner settings.

Next.js does not load this app-level `.env`. Web overrides belong in `apps/demo-web/.env.local` or the web process's shell:

- `RUNNER_BASE_URL`: defaults to `http://127.0.0.1:4001`. Change it if you change the runner's port.
- `NEXT_PUBLIC_CUA_DEFAULT_MODEL`: leave unset to use the runner's default model.
- `NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS`: defaults to `24`.

Restart services after configuration changes; rebuild the production web app after changing `NEXT_PUBLIC_*` values.

## Understand and change the sample

Start with the [architecture guide](docs/architecture.md) for the API loop, runtime, and package map. The [contribution guide](docs/contributing.md) covers development commands, checks, and production startup. Shared lab checks are documented in the [lab contribution guide](../labs/docs/contributing.md#checks).

Each run uses a fresh lab copy under `data/workspaces/<run-id>/`. Events, replay data, and screenshots are saved under `data/runs/<run-id>/`.

Generated JavaScript runs with your user permissions. Keep the runner on loopback and use environments you control; see the [safety and limitations](../README.md#safety-and-limitations).
