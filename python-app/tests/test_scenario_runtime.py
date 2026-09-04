import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.errors import RunnerCoreError
from app.scenario_runtime import RunExecutionContext, execute_scenario


@pytest.fixture
def flow(monkeypatch, tmp_path):
    client = SimpleNamespace(close=AsyncMock())
    worker = SimpleNamespace(close=AsyncMock())
    page = SimpleNamespace(url="http://127.0.0.1/lab", bring_to_front=AsyncMock())
    browser = SimpleNamespace(close=AsyncMock(), frontmost=AsyncMock(), page=page, target_label="lab", execution=None)
    server = SimpleNamespace(close=AsyncMock(), url_for=lambda _: "http://127.0.0.1/lab")
    launch_worker = AsyncMock(return_value=worker)
    launch_browser = AsyncMock(return_value=browser)
    monkeypatch.setattr("app.responses_loop.create_default_responses_client", lambda: client)
    monkeypatch.setattr("app.responses_loop.run_responses_code_loop", AsyncMock(return_value={"notes": ["model final"]}))
    monkeypatch.setattr("app.desktop.runtime.launch_python_runtime", launch_worker)
    monkeypatch.setattr("app.browser.launch_browser_session", launch_browser)
    monkeypatch.setattr("app.scenario_runtime.start_workspace_lab_server", AsyncMock(return_value=server))
    monkeypatch.setattr("app.scenario_runtime.hold_browser", AsyncMock())
    def context(lab="kanban", prompt="Do the task"):
        scenario = {"kanban": "kanban-reprioritize-sprint", "paint": "paint-draw-poster", "booking": "booking-complete-reservation"}[lab]
        return RunExecutionContext(detail={"run": {"labId": lab, "scenarioId": scenario, "browserMode": "headful",
                                   "prompt": prompt, "model": "fixture", "maxResponseTurns": 24},
                                   "workspacePath": str(tmp_path)}, signal=asyncio.Event(), screenshot_directory=Path(tmp_path),
                                   emit_event=AsyncMock(), capture_screenshot=AsyncMock(),
                                   sync_browser_state=AsyncMock(), complete_run=AsyncMock())
    return SimpleNamespace(context=context, worker=worker, browser=browser, server=server, client=client,
                           launch_worker=launch_worker, launch_browser=launch_browser)


@pytest.mark.parametrize("lab", ["kanban", "paint", "booking"])
async def test_all_scenarios_finish_only_with_awaited_resource_cleanup(flow, lab):
    context = flow.context(lab)
    await execute_scenario(context)
    flow.worker.close.assert_awaited_once()
    flow.browser.close.assert_awaited_once()
    flow.server.close.assert_awaited_once()
    flow.client.close.assert_awaited_once()
    context.complete_run.assert_awaited_once()
    assert set(context.complete_run.call_args.kwargs) == {"notes"}
    assert context.capture_screenshot.call_args.args[1] == f"{lab}-final"
    assert context.complete_run.call_args.kwargs["notes"] == ["model final"]
    assert flow.browser.execution is flow.worker


async def test_unknown_scenario_fails_before_desktop_start(flow):
    context = flow.context()
    context.detail["run"]["scenarioId"] = "missing"
    with pytest.raises(RunnerCoreError) as caught:
        await execute_scenario(context)
    assert caught.value.code == "unsupported_scenario"
    flow.launch_worker.assert_not_awaited()


async def test_browser_start_failure_closes_worker_lab_and_client(flow):
    flow.launch_browser.side_effect = RuntimeError("Browser launch failed")
    with pytest.raises(RuntimeError, match="Browser launch"):
        await execute_scenario(flow.context())
    flow.worker.close.assert_awaited_once()
    flow.server.close.assert_awaited_once()
    flow.client.close.assert_awaited_once()


async def test_failed_input_release_still_closes_all_resources(flow):
    flow.worker.close.side_effect = RunnerCoreError("Input release failed", code="input_release_failed")
    with pytest.raises(RunnerCoreError) as caught:
        await execute_scenario(flow.context())
    assert caught.value.code == "desktop_cleanup_failed"
    flow.browser.close.assert_awaited_once()
    flow.server.close.assert_awaited_once()
    flow.client.close.assert_awaited_once()


async def test_repeated_cancellation_does_not_abandon_cleanup(flow):
    entered, release = asyncio.Event(), asyncio.Event()
    async def close():
        entered.set()
        await release.wait()
    flow.worker.close.side_effect = close
    task = asyncio.create_task(execute_scenario(flow.context()))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    await task
    flow.worker.close.assert_awaited_once()
    flow.browser.close.assert_awaited_once()


@pytest.mark.parametrize("saved", [None, {"document": {"paintedPixelCount": 0}}], ids=["unsaved", "saved"])
async def test_paint_completion_does_not_read_or_export_the_draft(flow, saved):
    flow.browser.page.evaluate = AsyncMock(return_value=saved)
    context = flow.context("paint")
    await execute_scenario(context)
    context.complete_run.assert_awaited_once_with(notes=["model final"])
    flow.browser.page.evaluate.assert_not_awaited()
    assert context.capture_screenshot.call_args.args[1] == "paint-final"
    assert not (Path(context.detail["workspacePath"]) / "artwork").exists()
    flow.worker.close.assert_awaited_once()
    flow.browser.close.assert_awaited_once()
    flow.server.close.assert_awaited_once()
    flow.client.close.assert_awaited_once()
