# Container images

Build a browser or desktop environment for your computer-use harness:

| Image | Environment |
| --- | --- |
| `gpt6-js-image:local` | Node.js, Playwright, and Chromium; a screenshot check runs by default. |
| `gpt6-py-image:local` | Python, PyAutoGUI, Pillow, Xvfb, Openbox, and Chromium; the desktop starts by default. |

These images initialize the environment only. They do not include an agent loop,
code-execution service, persistent REPL, or `display()` helper. The guide's
`OPENAI_EXAMPLE_CODE_EXECUTION_URL` clients still require a separately implemented
execution service. Keep the OpenAI client and its API key outside these images.

## Build

You need Docker with Linux container support. No host Node.js, Python, or browser
installation is required. This version targets Linux amd64; other architectures
require amd64 emulation. All build dependencies use public distribution URLs.

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app
docker build --platform linux/amd64 -t gpt6-js-image:local -f containers/gpt6-js-image/Dockerfile containers
docker build --platform linux/amd64 -t gpt6-py-image:local -f containers/gpt6-py-image/Dockerfile containers
```

## JavaScript screenshot check

The default command launches Chromium with its sandbox enabled, renders a local
page, writes a 1440 × 900 PNG to stdout, and exits. Progress goes to stderr:

```bash
docker run --rm --init --platform linux/amd64 --network=none \
  --read-only --tmpfs /tmp:rw,nosuid,size=512m --shm-size=512m \
  --memory=2g --cpus=2 --pids-limit=256 --cap-drop=ALL \
  --security-opt no-new-privileges \
  --security-opt seccomp=containers/chromium-seccomp.json \
  gpt6-js-image:local > browser.png
```

Open `browser.png`; it should show **Browser ready**. The process should print
`PASS` and exit successfully. See [check.mjs](gpt6-js-image/check.mjs) for the small
Playwright launch example. Your harness is responsible for keeping its browser,
context, and page alive across tool calls.

## Python desktop and screenshot check

Start the desktop, then capture it with PyAutoGUI. The check waits up to 20 seconds
for Chromium to become visible:

```bash
docker run -d --name gpt6-py-image --init --platform linux/amd64 --network=none \
  --read-only --tmpfs /tmp:rw,nosuid,size=512m --shm-size=512m \
  --memory=2g --cpus=2 --pids-limit=256 --cap-drop=ALL \
  --security-opt no-new-privileges \
  --security-opt seccomp=containers/chromium-seccomp.json \
  gpt6-py-image:local
docker exec gpt6-py-image /opt/pyautogui/bin/python /app/check.py > desktop.png
```

Open `desktop.png`; it should show Chromium with **Desktop ready** on a
1440 × 1000 desktop. Chromium and PyAutoGUI share `DISPLAY=:99`. `/tmp` is writable
because the screenshot backend needs temporary files. PyAutoGUI's fail-safe stays
enabled. See [start.sh](gpt6-py-image/start.sh) and [check.py](gpt6-py-image/check.py).

Stop and remove the desktop when finished:

```bash
docker rm -f gpt6-py-image
```

## Connect your harness

The checks above use local pages and disable networking. For external browsing,
choose the network access your harness needs and apply appropriate egress limits.
No service ports are exposed by these images.

Use a disposable environment for model-generated code. The examples run as a
nonroot user with a read-only filesystem, resource limits, and Chromium's sandbox
enabled. Do not add API credentials or sensitive host mounts. If Chromium reports
user-namespace errors, check the Docker host's namespace support and the supplied
seccomp profile; do not disable the browser sandbox to work around the error.

The Playwright package and browser image are pinned together at 1.62.0; Python
dependencies are pinned with hashes. Chromium comes from the base image, avoiding
the old guide's incomplete `firefox-esr` package setup. The seccomp profile is
adapted from Playwright's Docker configuration; see [third-party notices](THIRD_PARTY_NOTICES.md).
