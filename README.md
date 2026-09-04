# Computer Use Sample Apps

Computer-use agents are AI systems that operate software to complete a task. They inspect an interface, choose an action, execute it, and check the result. At OpenAI, we build this loop around models that write code to interact with software. Code lets the model combine actions, process observations, and choose when to look again.

A persistent runtime keeps useful state and helper functions available between calls. The model can write a loop to fill several fields, check that each change took effect, and return only the text or screenshots it needs. This can reduce model round trips and repeated input context while giving the model feedback to correct mistakes.

This repository contains two computer-use agents: one runs JavaScript with **Playwright** to control a browser; the other runs Python with **PyAutoGUI** to control a desktop through screenshots, mouse input, and keystrokes. Both use the Responses API and the same console and labs. They show how to build this pattern with standard libraries; OpenAI products use their own runtimes and additional controls.

## First Run

You need **Node.js 22.20.0** and an **[OpenAI API key](https://platform.openai.com/api-keys)** with access to the configured model. Corepack uses the repository's pinned **pnpm 10.26.0**. Run these commands in your terminal, replacing the API key placeholder:

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
export OPENAI_API_KEY="your_api_key_here"
```

Both apps read the root `.env`; shell variables take precedence. You can save the key in `.env` to use it in later sessions.

Run either quickstart below from the repository root. Once it starts, open the [console](http://127.0.0.1:3000), choose a scenario, edit its prompt, and select **Start Run**. Runs make real API calls. Use **Stop** to interrupt a run; use **Ctrl+C** and wait for shutdown before switching apps.

## JavaScript / Playwright Quickstart

The JavaScript agent uses Playwright locators, screenshots, and browser controls in a persistent session, with a TypeScript server and agent loop. See the [JavaScript README](javascript-app/README.md) for the code walkthrough and recovery guidance.

```bash
pnpm playwright:install
pnpm dev:js
```

## Python / PyAutoGUI Quickstart

The Python agent runs its server, agent loop, and persistent PyAutoGUI worker in Python, controlling a visible browser on your desktop. Install **uv**, use **Python 3.10+** (the repo pins 3.12), and follow the [Python README](python-app/README.md#quickstart) for desktop permissions, platform setup, and a code walkthrough.

```bash
pnpm python:install
pnpm python:playwright:install
uv run --project python-app python -m app.desktop.worker --check
pnpm dev:python
```

## Repository Layout

```text
.
|-- console/                           Shared web console
|-- contracts/                         Shared request, event, and replay types
|-- javascript-app/
|   |-- src/
|   |   |-- responses-loop.ts          Core agent loop: model, code, feedback
|   |   |-- javascript-worker.ts       Persistent JavaScript execution worker
|   |   |-- browser/                   Browser session and worker communication
|   |   |-- runner-manager.ts          Run lifecycle and saved artifacts
|   |   `-- lab-catalog.ts             Shared lab catalog access
|   |-- docs/                          Architecture and contributing guides
|   `-- tests/                         JavaScript tests
|-- labs/
|   |-- catalog.json                   Scenario defaults and task prompts
|   |-- kanban-lab-template/           Project board: cards, columns, and tasks
|   |-- paint-lab-template/            Drawing canvas: shapes, layers, and tools
|   |-- booking-lab-template/          Hotel search and mock reservations
|   |-- docs/                          Task examples and lab guides
|   `-- tests/                         Lab and integration tests
|-- python-app/
|   |-- app/
|   |   |-- responses_loop.py          Core agent loop: model, code, feedback
|   |   |-- desktop/
|   |   |   |-- worker.py              Persistent Python execution worker
|   |   |   `-- runtime.py             Worker lifecycle and interruption
|   |   |-- runner.py                  Run lifecycle and saved artifacts
|   |   `-- lab_catalog.py             Shared lab catalog access
|   |-- docs/                          Architecture and contributing guides
|   `-- tests/                         Python tests
`-- scripts/
    `-- launch.mjs                     Starts one app and the shared console
```

Each run gets a fresh copy of a lab template. Workspaces, screenshots, and replays stay in the selected app's ignored `data/` directory. Use **Replay JSON** to inspect the recorded trace and the screenshot timeline to review earlier environment states. Generated dependencies, builds, and caches are omitted above. See the [lab guide](labs/docs/README.md) for task examples.

**Run finished** means the agent loop and cleanup ended normally. Inspect the screenshots, recorded trace, and model response to judge whether the requested task was accomplished.

## Safety and Limitations

- Generated code runs with your user permissions. These samples do not provide an operating-system sandbox or OpenAI's production action-review controls. Use the labs or other environments you control.
- Python controls your real mouse and keyboard, and screenshots may include other windows. Use a dedicated desktop session and keep the lab window in front on your primary monitor.
- A final answer does not prove the task succeeded. Inspect the result before relying on it.
- Keep API keys and run artifacts private. Environment files and generated run data are excluded from Git; keep services on their default loopback addresses.
- A crash can leave desktop input held down. Read the Python app's [interruption and recovery notes](python-app/README.md#interruption-and-recovery) before using it.

Licensed under the [MIT License](LICENSE).
