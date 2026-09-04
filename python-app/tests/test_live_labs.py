"""Opt-in model runs using the root .env. These tests operate the real desktop."""
import asyncio
import os
from pathlib import Path

import pytest

from app.config import load_environment
from app.lab_catalog import list_scenarios
from app.lease import BackendLease
from app.runner import RunnerManager

pytestmark = [pytest.mark.live, pytest.mark.skipif(os.environ.get("CUA_LIVE_TESTS") != "1", reason="Set CUA_LIVE_TESTS=1 to run live model/desktop tests.")]

PROMPTS = {item["id"]: item["defaultPrompt"] for item in list_scenarios()}


@pytest.mark.parametrize("scenario_id", list(PROMPTS))
async def test_live_responses_lab(scenario_id, tmp_path):
    load_environment()
    assert os.environ.get("OPENAI_API_KEY"), "Set OPENAI_API_KEY in the shell or root .env for live desktop tests."
    lease = BackendLease()
    lease.acquire()
    manager = RunnerManager(tmp_path / "data")
    try:
        detail = await manager.start_run({"scenarioId": scenario_id, "prompt": PROMPTS[scenario_id],
                                          "browserMode": "headful"})
        async def terminal():
            while True:
                current = await manager.get_run_detail(detail["run"]["id"])
                if current["run"]["status"] != "running":
                    return current
                await asyncio.sleep(0.5)
        final = await asyncio.wait_for(terminal(), 120)
        assert final["run"]["status"] == "completed", final["run"].get("summary", {}).get("notes")
        assert set(final["run"]["summary"]) == {"notes", "stepCount", "screenshotCount"}
        assert any(event["type"] == "function_call_completed" for event in final["events"])
        replay = await manager.get_replay_bundle(detail["run"]["id"])
        assert replay["version"] == 3
        assert replay["run"] == final["run"]
        final_screenshots = [artifact for artifact in replay["browser"]["screenshots"]
                             if artifact["label"] == f"{final['run']['labId']}-final"]
        assert final_screenshots
        assert all(Path(artifact["path"]).read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
                   for artifact in final_screenshots)
        assert not (Path(final["workspacePath"]) / "artwork").exists()
    finally:
        await manager.shutdown()
        lease.close()
