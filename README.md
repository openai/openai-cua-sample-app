# Computer-use sample apps

Runnable sample apps for building computer-use workflows with the Responses API. The shared browser labs cover Kanban, drawing, and booking.

## JavaScript + Playwright

The [JavaScript sample app](javascript-app/README.md) includes an operator console and a persistent Playwright JavaScript session. It supports headless and visible Chromium.

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app/javascript-app
corepack enable
pnpm install
cp .env.example .env
# Set OPENAI_API_KEY in .env.
pnpm playwright:install
pnpm dev
```

Open [the console](http://127.0.0.1:3000). See the [sample-app README](javascript-app/README.md) for prerequisites, model configuration, checks, and troubleshooting.

## Repository layout

- [`javascript-app/`](javascript-app/): application code, dependencies, configuration, and detailed documentation.
- [`labs/`](labs/): static lab templates and browser checks. Each run receives its own copy; templates remain unchanged.

Install and run commands from the sample-app directory. The repository root is not a package workspace.

Licensed under the [MIT License](LICENSE).
