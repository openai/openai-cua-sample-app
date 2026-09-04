# Contributing to the labs

The labs are self-contained browser applications. Sample apps copy each template into a fresh workspace for a run.

## Add or update a lab

Create or edit a template under `labs/<name>-lab-template/`. Keep its assets local and make the initial state readable from screenshots. Keep the template resettable by copying it into a fresh workspace.

Put lab descriptions, controls, task prompts, saved-state behavior, and verification rules in `labs/docs/`. Keep each template's README short and link to its guide here. Update the [lab index](README.md) when adding a lab.

## Verification and saved artifacts

Expose stable, read-only browser-side accessors for verification. Verify the requested final lab state and include enough observed and expected detail in failures to make replay review useful.

Document what gets saved and retained when verification is disabled or a run is interrupted. State the limits of each check so a passing result has a clear meaning.

## Check a change

Exercise the interactions and saved-state behavior affected by the change. Test against a fresh workspace copy.

Use the integrating sample app's test commands. The [JavaScript contributing guide](../../javascript-app/docs/contributing.md#checks) lists the current checks; the [paint guide](paint.md#checks) covers its browser suite.

To connect a lab to the JavaScript runner, follow [Add a scenario](../../javascript-app/docs/contributing.md#add-a-scenario).
