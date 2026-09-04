# JavaScript / Playwright Sample App

The model calls `exec_js` to run JavaScript in a persistent Playwright session. It can inspect pages, use locators, and control the browser. The server and agent loop are written in TypeScript.

## Quickstart

Follow the [JavaScript quickstart](../README.md#javascript--playwright-quickstart) in the root guide. On Linux, use `pnpm playwright:install:with-deps` if Chromium needs system libraries.

The browser starts in **Headless** mode. Choose **Visible** under **Advanced settings** to watch it work.

## Code Walkthrough

Both this app and the [Python sample](../python-app/README.md#code-walkthrough) follow the same five stages:

1. **Define the tool.** [`buildCodeToolDefinitions`](src/responses-loop.ts#L122) declares `exec_js`, a function that accepts a `code` string, and describes the available Playwright objects and output helpers.
2. **Request a response.** [`runResponsesCodeLoop`](src/responses-loop.ts#L262) sends the task, instructions, and tool definition to the Responses API. The model can return generated JavaScript in a `function_call`.
3. **Execute the code.** The [worker](src/javascript-worker.ts#L43) runs it with `browser`, `context`, `page`, and `Buffer` available. The browser session stays alive between calls. Each code block runs in an async function; use `globalThis` to retain variables between calls. Each run starts fresh.
4. **Return observations.** `console.log()` produces text and `display()` produces images. The [loop](src/responses-loop.ts#L314) returns these as `function_call_output` with the original `call_id`, so the model can inspect the result and choose its next action.
5. **Continue or finish.** The next request includes those results and `previous_response_id`. Commentary continues the loop; a final answer finishes it when no tool calls remain. The worker preserves execution state independently of the API conversation.

For example, to inspect the current browser page, the model might return:

```json
{
  "type": "function_call",
  "name": "exec_js",
  "call_id": "call_1",
  "arguments": "{\"code\":\"display((await page.screenshot()).toString('base64'));\"}"
}
```

After executing the code, the runner sends this item in the next request's `input` array. The PNG bytes are abbreviated here:

```json
{
  "type": "function_call_output",
  "call_id": "call_1",
  "output": [
    {
      "type": "input_image",
      "image_url": "data:image/png;base64,<PNG_BYTES>",
      "detail": "original"
    }
  ]
}
```

Follow the [architecture guide](docs/architecture.md#supporting-modules) for the HTTP server, worker connection, run lifecycle, and shared components.

## Interruption and Recovery

**Stop** interrupts the run and waits for the worker, browser, and lab server to close. Ordinary script errors return to the model so it can correct them. Each code call has a 60-second deadline; exceeding it ends the run. The separate worker lets the runner terminate blocked JavaScript.

Refreshing the console reconnects to an active run. If a Start response is unconfirmed, **Check again** checks for an active run without submitting another. **Ctrl+C** stops the app; wait for shutdown before launching either backend again.

See [contributing](docs/contributing.md) for tests and production startup, and the root guide for [safety and limitations](../README.md#safety-and-limitations).
