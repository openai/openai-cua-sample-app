# Python / PyAutoGUI sample app

A computer-use sample using the Responses API. The model executes Python through `exec_py` in a persistent PyAutoGUI process. The server, console, and model-request loop are TypeScript; Playwright manages the visible Chromium window, previews, and verification.

Each run follows **call the model → execute Python → return output/screenshots → repeat**. The shared [labs](../labs/docs/README.md) provide the tasks and browser applications.

## Quickstart

You need Node.js **22.20.0**, pnpm **10.26.0**, Python **3.10+**, and a graphical desktop. From the repository root, using Bash/Zsh:

```bash
cd python-app
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
python3 -m venv .venv
.venv/bin/python -m pip install -r runtimes/requirements.txt
pnpm playwright:install
```

Set `OPENAI_API_KEY=your_key_here` in `.env`, then check desktop access:

- **macOS:** enable Accessibility and Screen Recording for the app launching the runner in System Settings → Privacy & Security, then restart that app.
- **Linux:** use an X11 desktop with PyAutoGUI's screenshot and Tk dependencies installed. Use `pnpm playwright:install:with-deps` if Chromium needs system libraries.
- **Windows:** replace `.venv/bin/python` with `.venv\Scripts\python.exe` and adapt the shell commands.

Use a dedicated desktop session: generated Python runs with your user permissions, and screenshots can include other windows.

```bash
.venv/bin/python runtimes/python-worker.py --check
pnpm dev
```

Open the [console](http://127.0.0.1:3041), choose a task, edit its prompt, and start a run. Keep the lab window in front on your primary monitor while the model uses the mouse and keyboard. The runner listens on port **4041**.

Defaults are **gpt-5.6**, **24 model turns**, and **verification off**. To enable verification, select **Run verification checks** under **Advanced settings**. Kanban and Booking need the structured prompts in the [lab task guide](../labs/docs/scenarios.md); the supplied freeform prompts work with verification off.

## Where to start in the code

Follow the [Responses loop](packages/runner-core/src/responses-loop.ts), [Python process connection](packages/browser-runtime/src/python-runtime.ts), and [Python worker](runtimes/python-worker.py).

`exec_py` executes code with `pyautogui`, `log()`, and `display()` available. Python globals persist between calls within a run. For example, `display(pyautogui.screenshot())` returns an image in the same coordinates as mouse input, including on Retina displays.

Each run gets a fresh lab copy under `data/`. Keep `python-app/` and `labs/` as siblings when copying the sample, and recreate `.venv` after moving it. Install dependencies from this folder; the repository root is not a pnpm workspace.

See [architecture](docs/architecture.md) for the file map and lifecycle, and [contributing](docs/contributing.md) for checks and development commands.

## Interruption and recovery

**Stop** interrupts execution and waits for cleanup. Moving the pointer into a PyAutoGUI failsafe corner ends the run on the next PyAutoGUI action. Ordinary Python exceptions are returned to the model so it can correct its code.

Refreshing the console reconnects to an active run. If a Start request is unconfirmed, use **Check again** to look for an active run. Ctrl+C in the launching terminal stops the services and requests cleanup.

## Configuration

Runner settings belong in `.env` or the runner's shell. The provided development and production scripts load `.env`; shell variables take precedence. See [.env.example](.env.example) for runner settings. Set `CUA_PYTHON` to an absolute Python executable to override the default lookup: this sample's `.venv`, then `python3`.

Next.js uses `apps/demo-web/.env.local` or its launching shell, rather than the runner's `.env`:

- `RUNNER_BASE_URL`: defaults to `http://127.0.0.1:4041`.
- `NEXT_PUBLIC_CUA_DEFAULT_MODEL`: leave unset to use the runner's model.
- `NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS`: defaults to `24`.

Restart services after configuration changes. If changing the runner port, update `RUNNER_BASE_URL` too. Rebuild the web app after changing `NEXT_PUBLIC_*` values in production.

See the repository's [license](../LICENSE).
