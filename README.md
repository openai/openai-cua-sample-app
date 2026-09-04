# Computer Use Sample Apps

An agent is more useful when it can put a plan into practice. Computer use gives it access to the controls in a browser or desktop app, so it can edit, arrange, and create things on your behalf.

In these samples, the model drives those controls by writing code. It can group related actions, repeat a routine, and save variables for later steps. The sample app runs the code and returns text and screenshots; the model uses that feedback to decide what to do next.

Try it on a project board, a drawing canvas, or a mock hotel booking site. Each sample includes a Responses API loop and a console where you can follow the run, inspect its screenshots, and review the saved replay. Use the examples to learn the pattern, then adapt it to your own application.

## First run

Both samples run the same local labs:

- [JavaScript + Playwright](javascript-app/README.md#first-run) executes JavaScript in headless or visible Chromium.
- [Python + PyAutoGUI](python-app/README.md#quickstart) executes Python to control the visible desktop's mouse and keyboard.

Both need **Node.js 22.20.0**, **pnpm 10.26.0**, and an **OpenAI API key** with access to the configured model. The Python sample also needs **Python 3.10+**, a graphical desktop, and screen-capture and input permissions.

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app
```

Each quickstart covers installation, API-key configuration, and startup. Install and run each sample from its own directory; each has its own dependencies, configuration, and run data. The repository root is not a pnpm workspace.

Once the console is running, choose a scenario, edit its prompt, and select **Start Run**. Use **Stop** to interrupt a run. All three scenarios make real API calls. See the [lab task guide](labs/docs/scenarios.md) for example prompts.

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
