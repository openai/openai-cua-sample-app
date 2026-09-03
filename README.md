# Computer-use sample apps

Use the Responses API and Playwright to run browser tasks. Watch the model move Kanban cards, draw a picture, or complete a booking in three local labs.

The model's code runs with your permissions. A separate process lets **Stop** end it. This is not a security sandbox. Use local labs or other environments you control.

## Quickstart

Use Node.js **22.20.0** and pnpm **10.26.0**. Your API key must have access to the configured model. The default is `gpt-5.6-sol`; set `CUA_DEFAULT_MODEL` in `.env` to change it.

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app/javascript-app
corepack enable
pnpm install
cp .env.example .env
# Edit .env and set OPENAI_API_KEY.
pnpm playwright:install
pnpm dev
```

Open [the console](http://127.0.0.1:3000). See the [JavaScript + Playwright guide](javascript-app/README.md) for a guided first run, Linux setup, configuration, and checks.

## Repository layout

- [`javascript-app/`](javascript-app/): app code, configuration, and docs.
- [`labs/`](labs/): shared lab templates. Each run starts from a fresh copy.

Run package commands from `javascript-app/`. The repository root is not a pnpm workspace.

Read more about the [architecture](javascript-app/docs/architecture.md), [scenario prompts and verification](javascript-app/docs/scenarios.md), or [contributing](javascript-app/docs/contributing.md).

Licensed under the [MIT License](LICENSE).
