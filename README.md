# Computer-use sample apps

Two samples for computer-use workflows with the Responses API and the same local browser labs. Choose the action runtime you want to explore:

| Sample | Model actions | Console / runner ports |
| --- | --- | --- |
| [JavaScript + Playwright](javascript-app/README.md) | Persistent JavaScript session in headless or visible Chromium | 3000 / 4001 |
| [Python + PyAutoGUI](python-app/README.md) | Python controlling the visible desktop's mouse and keyboard | 3041 / 4041 |

Both samples use TypeScript for the server, console, and model-request loop. In the Python sample, Python executes the model's computer actions.

## First run

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app
```

Follow the [JavaScript quickstart](javascript-app/README.md#first-run) or [Python quickstart](python-app/README.md#quickstart) to install dependencies, configure an API key, and start the sample.

Install and run each app from its own directory. Each has its own lockfile, environment, and generated data. The repository root is not a pnpm workspace.

## Repository layout

```text
javascript-app/   JavaScript action runtime, runner, console, and app tests
python-app/       Python action runtime, runner, console, and app tests
labs/             Shared templates, task data, documentation, and lab tests
```

Each run uses a fresh copy of a lab template. See the [lab guide](labs/docs/README.md) for tasks and verification, and [lab checks](labs/docs/contributing.md#checks) when changing the labs. App development instructions live in the [JavaScript](javascript-app/docs/contributing.md) and [Python](python-app/docs/contributing.md) guides.

## Safety and limitations

- Use the included labs or other environments you control. Generated code runs with your user permissions; these samples do not provide an operating-system security sandbox.
- Python controls the real desktop. Use a dedicated session, keep the intended window in front, and read its [interruption behavior](python-app/README.md#interruption-and-recovery).
- Keep API keys in local configuration. Environment files and generated run data are excluded from Git.
- Keep the runner on its default loopback address for local development.

Licensed under the [MIT License](LICENSE).
