# Python / PyAutoGUI Sample App

The model calls `exec_py` to run Python in a persistent process. PyAutoGUI lets it inspect the desktop and act through mouse input and keystrokes. The server, agent loop, and execution worker are all written in Python.

## Quickstart

Follow the [Python quickstart](../README.md#python--pyautogui-quickstart) in the root guide. Before launching, set up desktop access:

- **macOS:** enable Accessibility and Screen Recording for the app launching the runner in System Settings → Privacy & Security, then restart that app.
- **Linux:** use an X11 desktop with PyAutoGUI's screenshot and Tk dependencies installed. If Chromium needs system libraries, run `uv run --project python-app playwright install --with-deps chromium` from the repository root.
- **Windows:** use a graphical desktop session.

Use a dedicated desktop session and keep the lab window in front on your primary monitor. Python controls your real mouse and keyboard; it requires a visible browser. The quickstart's `--check` command tests desktop access before you start.

## Code Walkthrough

Both this app and the [JavaScript sample](../javascript-app/README.md#code-walkthrough) follow the same five stages:

1. **Define the tool.** [`build_code_tool_definitions`](app/responses_loop.py#L43) declares `exec_py`, a function that accepts a `code` string, and describes the available PyAutoGUI operations and output helpers.
2. **Request a response.** [`run_responses_code_loop`](app/responses_loop.py#L207) sends the task, instructions, and tool definition to the Responses API. The model can return generated Python in a `function_call`.
3. **Execute the code.** The [worker](app/desktop/worker.py#L66) runs it with `pyautogui` available. The worker keeps Python globals between calls while PyAutoGUI operates the same desktop. Each run gets a new worker. Screenshots use mouse-input coordinates, including on Retina displays.
4. **Return observations.** `log()` produces text and `display()` produces images. The [loop](app/responses_loop.py#L267) returns these as `function_call_output` with the original `call_id`, so the model can inspect the result and choose its next action.
5. **Continue or finish.** The next request includes those results and `previous_response_id`. Commentary continues the loop; a final answer finishes it when no tool calls remain. The worker preserves execution state independently of the API conversation.

For example, to inspect the current desktop, the model might return:

```json
{
  "type": "function_call",
  "name": "exec_py",
  "call_id": "call_1",
  "arguments": "{\"code\":\"display(pyautogui.screenshot())\"}"
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

Playwright handles browser setup and preview screenshots; PyAutoGUI handles the model's desktop actions. Follow the [architecture guide](docs/architecture.md#supporting-modules) for the HTTP server, worker connection, and run lifecycle.

## Interruption and Recovery

**Stop** interrupts the run, attempts to release held input, and waits for the worker, browser, and lab server to close. Moving the pointer into a PyAutoGUI failsafe corner ends the run on the next PyAutoGUI action. Ordinary Python exceptions return to the model so it can correct them. Each code call has a 60-second deadline.

Refreshing the console reconnects to an active run. If a Start response is unconfirmed, **Check again** checks for an active run without submitting another. **Ctrl+C** stops the app; wait for shutdown before launching either backend again. Do not use Uvicorn reload or multiple workers.

If the runner reports an input-cleanup failure, it blocks new runs. Release held keys and mouse buttons, check desktop permissions, then restart. After a crash, check for held input and leftover processes before starting again.

See [contributing](docs/contributing.md) for tests and production startup, and the root guide for [safety and limitations](../README.md#safety-and-limitations).
