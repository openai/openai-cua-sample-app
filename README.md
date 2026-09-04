# Computer-use Sample Apps

Sample apps for computer-use workflows with the Responses API. This repository contains the [JavaScript + Playwright app](javascript-app/README.md) and three shared browser labs.

## What This Repo Demonstrates

- how to connect a model to an application, observe its state, and perform a task
- how to start each run from a fresh lab workspace and verify the result
- how to review a run through screenshots, events, and saved artifacts

## Prerequisites

- Git to clone the repository
- an OpenAI API key with access to the model you plan to use
- the runtime and browser dependencies listed in the [sample-app guide](javascript-app/README.md#prerequisites)

## First Run

Clone the repository:

```bash
git clone https://github.com/openai/openai-cua-sample-app.git
cd openai-cua-sample-app
```

Continue with the [JavaScript + Playwright setup](javascript-app/README.md#first-run) to install dependencies, configure your key, and start the app.

Each sample app keeps its setup, configuration, and run data in its own directory. Follow its README for commands and environment-file locations. The repository root is not a pnpm workspace.

## Shared Labs

Templates live in `labs/` and are copied into a fresh workspace for each run. See the [lab documentation](labs/docs/README.md) for descriptions, task prompts, verification rules, and contribution guidance.

## Repo Map

- [`javascript-app`](javascript-app/)
  JavaScript app code, workspace configuration, and detailed documentation
- [`labs`](labs/)
  Shared static lab templates copied into each run's workspace

## Safety And Limitations

- Use the included labs or other environments you control.
- Treat model-generated code as code running with your user permissions. These sample apps do not provide an operating-system security sandbox.
- Keep API keys in local configuration. Environment files and run data are excluded from Git.
- Lab verification checks a defined result. A successful lab run does not establish reliability on arbitrary websites.

Licensed under the [MIT License](LICENSE).
