# Code-execution containers

Build the browser or desktop execution service used by the computer-use guide's
JavaScript and Python [code-execution clients](https://developers.openai.com/api/docs/guides/tools-computer-use#code-execution-harness-examples).
These are separate from this repository's web demo.
The images contain no OpenAI client or API key; run the guide's client on your host.

| Image | Runtime | Client endpoint |
| --- | --- | --- |
| `gpt6-js-image:local` | Node.js, Playwright, and headless Chromium; persistent `browser`, `context`, `page`, `console.log()`, and `display(base64_image_string)` | `http://127.0.0.1:8001/execute` |
| `gpt6-py-image:local` | Python, PyAutoGUI, Pillow, Xvfb, Openbox, and windowed Chromium; persistent Python variables, `time`, `log(value)`, and `display(PIL_image)` | `http://127.0.0.1:8002/execute` |

The JavaScript viewport is 1440 × 900. The Python desktop is 1440 × 1000, including
browser chrome. PyAutoGUI and Chromium use the same X11 display (`:99`).

## Before you start

Install Docker with Linux container support and Docker Compose v2.20 or later, plus
Node.js 22 or later for the token command below. No host Playwright, Chromium,
Python, or PyAutoGUI installation is required to build and check the containers.
This initial version targets Linux amd64; other architectures require amd64
emulation. The build downloads the base image and dependencies.

Use a disposable machine for model-generated code. The browser can access external
websites through Docker's bridge network. The services bind to host loopback, require a bearer
token, and accept one session per container. Do not expose them to other users or
put credentials or host mounts in the containers. The code has the container
user's privileges; Node's `vm` and Python globals only preserve variables and are
not security boundaries. These are local development examples, not a multi-tenant
execution platform.

## Build and start

Clone the repository, then run these commands from its root:

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app
export OPENAI_EXAMPLE_CODE_EXECUTION_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
docker compose -f containers/compose.yaml up --build -d --wait
```

Keep this token in the shell that will run the API client. This token authenticates
your local execution service; it is not an OpenAI API key. Compose passes only
this variable to the containers. It does not load your OpenAI key into them.

To start only one image, append its service name:

```bash
docker compose -f containers/compose.yaml up --build -d --wait gpt6-py-image
```

Each Dockerfile installs its dependencies and starts the execution service. The
Python entrypoint also starts Xvfb, a window manager, and Chromium, then waits for
the desktop to be ready. There is no separate environment initialization command.

## Verify the environment without an API key

```bash
docker compose -f containers/compose.yaml exec -T gpt6-js-image node /app/check.mjs
docker compose -f containers/compose.yaml exec -T gpt6-py-image node /app/check.mjs
```

Each command should print `PASS` after submitting a local form using keyboard,
click, and scroll interactions. It also checks a keyboard shortcut, variables
persisting between requests, screenshot PNG data and dimensions, authentication,
and rejection of a second session. The check makes no OpenAI API calls.

The check uses the container's single session. Reset both containers before
starting an API client, which generates a new session ID:

```bash
docker compose -f containers/compose.yaml restart
docker compose -f containers/compose.yaml up -d --wait
```

## Connect the guide's client

Use the same shell, keeping `OPENAI_EXAMPLE_CODE_EXECUTION_TOKEN` set. Set
`OPENAI_API_KEY` for the client only, then select one execution endpoint:

```bash
# JavaScript / Playwright
export OPENAI_EXAMPLE_CODE_EXECUTION_URL=http://127.0.0.1:8001/execute

# Or Python / PyAutoGUI
export OPENAI_EXAMPLE_CODE_EXECUTION_URL=http://127.0.0.1:8002/execute
```

Save the guide's displayed JavaScript client as `computer-use.mjs`, install the
OpenAI SDK with `npm install openai`, and run it:

```bash
node computer-use.mjs --prompt 'Open http://127.0.0.1:8000/fixture, enter Alice, scroll down, and submit the form. Take a screenshot of the result.'
```

Or save the displayed Python client as `computer_use.py`, install the SDK in your
Python environment with `python -m pip install openai`, and run:

```bash
python computer_use.py --prompt 'Open http://127.0.0.1:8000/fixture, enter Alice, scroll down, and submit the form. Take a screenshot of the result.'
```

The URL in this prompt is inside the container. You can also use an external-site
prompt when your Docker host has internet access. The image names do not
choose a model; the API client sets the model, such as `gpt-6-astra` for projects
with access. Approve the generated code in the client when prompted.

Restart the selected container before each new client run. Browser state and
runtime variables persist within a run and are discarded when the container is
recreated. A 25-second execution deadline stops the container, including hung
code, before the guide's 30-second client timeout. A PyAutoGUI fail-safe event
also stops the Python container; inspect the cause before restarting it.

## Network access

Compose publishes only the execution-service ports, bound to host loopback.
Outbound networking is enabled for browser tasks; this example does not implement
a domain allowlist. Apply your own egress restrictions for real tasks. Do not set
the Compose network to `internal: true` as a substitute: internal bridge networks
can disable published ports, preventing the host API client from connecting.

## HTTP contract

Send `POST /execute` with `Content-Type: application/json` and
`Authorization: Bearer <OPENAI_EXAMPLE_CODE_EXECUTION_TOKEN>`:

```json
{"session_id":"my-session","language":"python","code":"display(pyautogui.screenshot())"}
```

Use `"javascript"` and `display((await page.screenshot()).toString("base64"));`
for the JavaScript image. Responses have an `output` array containing
`input_text` items or PNG `input_image` items with `detail: "original"`. Images
are encoded in memory. The service accepts at most 64 KiB of code per call and
approximately 16 MiB of output. Concurrent calls and different session IDs return
HTTP 409. Ordinary execution errors return text for the model to inspect.

`GET /health` reports readiness without executing code. `/fixture` is a local
test page. No API key or OpenAI SDK is required for either route.

## Troubleshooting and cleanup

```bash
docker compose -f containers/compose.yaml ps -a
docker compose -f containers/compose.yaml logs --tail=100
docker compose -f containers/compose.yaml down
```

If Chromium reports that user namespaces are unavailable, use a Docker host that
supports unprivileged user namespaces and the supplied seccomp profile. Chromium
runs as a nonroot user with its sandbox enabled. Do not work around startup errors
by disabling that sandbox.

Playwright and its browser image are pinned together at 1.62.0. Python dependencies
are pinned with hashes. The Dockerfiles use the browser bundled with Playwright,
avoiding the old Ubuntu `firefox-esr` package-installation failure. The
[`chromium-seccomp.json`](chromium-seccomp.json) profile comes from
[Playwright v1.62.0](https://github.com/microsoft/playwright/blob/v1.62.0/utils/docker/seccomp_profile.json),
with `chroot` permitted for Chromium's sandbox inside its user namespace when
the outer container drops all capabilities. See [Playwright's Docker guidance](https://playwright.dev/docs/docker)
and [PyAutoGUI's Linux requirements](https://pyautogui.readthedocs.io/en/latest/install.html).
