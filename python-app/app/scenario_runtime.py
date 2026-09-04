"""Run-scoped lab setup, execution, screenshots, and awaited teardown."""
import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from .errors import RunnerCoreError
from .lab_catalog import instructions, list_scenarios
from .lab_server import start_workspace_lab_server
from .processes import assert_active


@dataclass
class RunExecutionContext:
    detail: dict
    signal: asyncio.Event
    screenshot_directory: Path
    emit_event: Callable[..., Awaitable]
    capture_screenshot: Callable[..., Awaitable]
    sync_browser_state: Callable[..., Awaitable]
    complete_run: Callable[..., Awaitable]


async def delay(milliseconds: int, signal: asyncio.Event) -> None:
    assert_active(signal)
    try:
        await asyncio.wait_for(signal.wait(), milliseconds / 1000)
    except asyncio.TimeoutError:
        return
    raise asyncio.CancelledError("Run aborted.")


async def hold_browser(context: RunExecutionContext) -> None:
    if context.detail["run"]["browserMode"] != "headful":
        return
    prompt = context.detail["run"]["prompt"].lower()
    match = re.search(r"wait\s+(\d+)\s*(?:seconds?|secs?|s)\b|keep(?:\s+it)?\s+open\s+for\s+(\d+)\s*(?:seconds?|secs?|s)\b", prompt)
    if match:
        milliseconds = min(15000, max(1000, int(match[1] or match[2]) * 1000))
    else:
        milliseconds = 5000 if any(word in prompt for word in ("wait", "hold open", "keep open", "stay open")) else 3500
    await context.emit_event({"type": "run_progress", "level": "pending", "detail": f"{milliseconds / 1000:g}s operator review window",
                              "message": "Holding the headful browser session open before teardown."})
    await delay(milliseconds, context.signal)


async def execute_scenario(context: RunExecutionContext) -> None:
    from .browser import launch_browser_session
    from .desktop.runtime import launch_python_runtime
    from .responses_loop import create_default_responses_client, run_responses_code_loop

    run = context.detail["run"]
    if not any(item["id"] == run["scenarioId"] and item["labId"] == run["labId"] for item in list_scenarios()):
        raise RunnerCoreError(f"Unsupported public scenario: {run['scenarioId']}", code="unsupported_scenario", status_code=404,
                              hint="Use one of the public scenarios from /api/scenarios.")
    client = create_default_responses_client()
    lab_id = run["labId"]
    lab_server = None
    python = None
    session = None

    async def cleanup() -> None:
        errors = []
        for resource in (python, session, lab_server, client):
            if resource is not None:
                try:
                    await resource.close()
                except (Exception, asyncio.CancelledError) as error:  # noqa: BLE001 - attempt every owned resource cleanup
                    errors.append(error)
        if errors:
            release_failed = any(getattr(error, "code", "") in ("input_release_failed", "input_release_timeout") for error in errors)
            raise RunnerCoreError("Run cleanup failed: " + "; ".join(str(error) for error in errors),
                                  code="desktop_cleanup_failed" if release_failed else "cleanup_failed",
                                  hint="Release held keys and mouse buttons, check desktop input permissions, then restart the runner before starting another run." if release_failed else None)

    try:
        assert_active(context.signal)
        if run["browserMode"] == "headless":
            raise RunnerCoreError("Local PyAutoGUI requires a visible browser.", code="visible_browser_required", status_code=400)
        await context.emit_event({"type": "run_progress", "level": "ok", "detail": run["model"],
                                  "message": f"Using the live Responses API code loop for the {lab_id} lab."})
        lab_server = await start_workspace_lab_server(workspace_path=context.detail["workspacePath"])
        lab_url = lab_server.url_for("index.html")
        python = await launch_python_runtime(signal=context.signal)
        assert_active(context.signal)
        session = await launch_browser_session(browser_mode=run["browserMode"], screenshot_dir=context.screenshot_directory,
                                                url=lab_url, target_label=f"run-scoped {lab_id} lab", signal=context.signal)
        session.execution = python
        await session.frontmost()
        assert_active(context.signal)
        await context.emit_event({"type": "lab_started", "level": "ok", "detail": lab_url,
                                  "message": "HTTP lab server booted from the mutable workspace."})
        await context.sync_browser_state(session)
        await context.emit_event({"type": "browser_session_started", "level": "ok", "detail": session.target_label,
                                  "message": "Browser session launched and bound to the run."})
        await context.emit_event({"type": "browser_navigated", "level": "ok", "detail": session.page.url,
                                  "message": f"Browser navigated to the {lab_id} lab."})
        await context.capture_screenshot(session, f"{lab_id}-loaded")
        result = await run_responses_code_loop(context=context, session=session, instructions=instructions(lab_id, session.page.url),
                                               max_response_turns=run["maxResponseTurns"], client=client)
        await context.capture_screenshot(session, f"{lab_id}-final")
        await hold_browser(context)
        await context.complete_run(notes=result["notes"])
    finally:
        # Once teardown starts, a second cancellation must not abandon resources.
        teardown = asyncio.create_task(cleanup())
        while True:
            try:
                await asyncio.shield(teardown)
                break
            except asyncio.CancelledError:
                if teardown.done():
                    await teardown
                    break
