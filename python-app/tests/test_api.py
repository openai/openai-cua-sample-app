import asyncio
import json

import httpx
import pytest

from app.api import create_app
from app.lab_catalog import list_scenarios
from app.lease import BackendLease
from app.runner import RunnerManager


@pytest.fixture
async def api(tmp_path):
    async def execute(context):
        await context.signal.wait()
    template = tmp_path / "template"
    template.mkdir()
    (template / "index.html").write_text("fixture")
    scenarios = [{**item, "workspaceTemplatePath": str(template)} for item in list_scenarios()]
    manager = RunnerManager(tmp_path / "data", executor=execute, scenarios=scenarios)
    app = create_app(manager=manager, acquire_lease=False)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://runner") as client:
        yield app, manager, client


async def test_routes_and_capabilities(api):
    app, _, client = api
    assert (await client.get("/health")).json() == {"status": "ok", "service": "runner"}
    capabilities = (await client.get("/api/capabilities")).json()
    assert capabilities["backendId"] == "python"
    assert capabilities["browserModes"] == ["headful"]
    assert capabilities["instanceId"] == app.state.instance_id
    assert "verificationEnabled" not in capabilities["defaults"]
    scenarios = (await client.get("/api/scenarios")).json()
    assert len(scenarios) == 3
    assert all("verification" not in scenario for scenario in scenarios)
    assert (await client.get("/api/runs/active")).json() is None
    result = await client.post("/api/runs", json={"scenarioId": "paint-draw-poster", "prompt": "Draw"})
    assert result.status_code == 202
    run_id = result.json()["runId"]
    assert (await client.get("/api/runs/active")).json()["run"]["id"] == run_id
    assert (await client.get(f"/api/runs/{run_id}")).json()["run"]["browserMode"] == "headful"
    assert (await client.post(f"/api/runs/{run_id}/stop")).json()["run"]["status"] == "cancelled"
    assert (await client.get(f"/api/runs/{run_id}/replay")).json()["version"] == 3
    assert (await client.post("/api/scenarios/paint-draw-poster/reset")).json()["scenarioId"] == "paint-draw-poster"
    assert (await client.get("/api/runs/active")).json() is None


@pytest.mark.parametrize("payload", [{"scenarioId": "paint-draw-poster", "prompt": "Draw", "mode": "code"},
                                     {"scenarioId": "paint-draw-poster", "prompt": "Draw", "verificationEnabled": "false"},
                                     {"scenarioId": "paint-draw-poster", "prompt": "Draw", "browserMode": "headless"}])
async def test_request_errors_before_workspace_allocation(api, payload):
    _, manager, client = api
    result = await client.post("/api/runs", json=payload)
    assert result.status_code == 400
    assert set(result.json()) == {"code", "error", "hint"}
    assert not manager.storage.root.exists()


async def test_malformed_json_and_unexpected_error_envelope(api, monkeypatch):
    _, manager, client = api
    result = await client.post("/api/runs", content="{", headers={"Content-Type": "application/json"})
    assert result.status_code == 400
    assert result.json()["code"] == "invalid_request"
    async def broken():
        raise RuntimeError("private stack trace")
    monkeypatch.setattr(manager, "get_active_run_detail", broken)
    response = await client.get("/api/runs/active")
    assert response.status_code == 500
    assert "private stack" not in response.text


async def test_origin_and_backend_guard(api):
    _, manager, client = api
    for origin in ("http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"):
        response = await client.get("/api/capabilities", headers={"Origin": origin})
        assert response.headers["access-control-allow-origin"] == origin
    for origin in ("https://foreign.example", "http://127.0.0.1:3041", "http://localhost:3050"):
        denied = await client.post("/api/runs", headers={"Origin": origin}, json={})
        assert denied.status_code == 403
    for expected in ("javascript", ""):
        denied = await client.post("/api/runs", headers={"X-CUA-Backend": expected}, json={})
        assert denied.status_code == 409
        assert denied.json()["code"] == "backend_mismatch"
    allowed = await client.options("/api/runs", headers={"Origin": "http://localhost:3000"})
    assert allowed.status_code == 204
    assert "X-CUA-Backend" in allowed.headers["access-control-allow-headers"]
    assert not manager.storage.root.exists()


async def test_sse_replays_and_deduplicates_snapshot_subscription_race(api, monkeypatch):
    _, manager, client = api
    detail = await manager.start_run({"scenarioId": "paint-draw-poster", "prompt": "Draw"})
    run_id = detail["run"]["id"]
    original = manager.get_run_detail
    reads = 0
    async def racing(run_id):
        nonlocal reads
        reads += 1
        if reads == 2:
            await manager.emit_event(manager.contexts[run_id], {"type": "run_progress", "message": "between reads", "level": "ok"})
        return await original(run_id)
    monkeypatch.setattr(manager, "get_run_detail", racing)
    streaming = asyncio.create_task(client.get(detail["eventStreamUrl"], headers={"Origin": "http://localhost:3000"}))
    for _ in range(100):
        if reads >= 2:
            break
        await asyncio.sleep(0.001)
    await manager.stop_run(run_id)
    response = await asyncio.wait_for(streaming, 2)
    events = [json.loads(frame.removeprefix("data: ")) for frame in response.text.strip().split("\n\n")]
    assert [event["sequence"] for event in events] == list(range(len(events)))
    assert sum(event["message"] == "between reads" for event in events) == 1
    assert events[-1]["type"] == "run_cancelled"
    assert not manager.contexts[run_id].subscribers
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    persisted = await client.get(detail["eventStreamUrl"])
    assert persisted.text == response.text


async def test_historical_running_sse_has_json_error_and_artifacts_are_confined(api):
    _, manager, client = api
    detail = await manager.start_run({"scenarioId": "paint-draw-poster", "prompt": "Draw"})
    run_id = detail["run"]["id"]
    await manager.stop_run(run_id)
    directory = manager.storage.run_dir(run_id)
    (directory / "screenshots" / "safe.png").write_bytes(b"png")
    assert (await client.get(f"/api/runs/{run_id}/artifacts/screenshots/safe.png")).content == b"png"
    outside = directory / "private.json"
    outside.write_text("secret")
    (directory / "screenshots" / "linked.png").symlink_to(outside)
    assert (await client.get(f"/api/runs/{run_id}/artifacts/screenshots/linked.png")).status_code == 404
    stored = json.loads((directory / "replay.json").read_text())
    stored["run"]["status"] = "running"
    (directory / "replay.json").write_text(json.dumps(stored))
    manager.contexts.clear()
    response = await client.get(detail["eventStreamUrl"])
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


async def test_lost_http_start_is_retained_and_discoverable(api, monkeypatch):
    app, manager, client = api
    entered, release = asyncio.Event(), asyncio.Event()
    original = manager.storage.prepare
    async def prepare(*args):
        entered.set()
        await release.wait()
        await original(*args)
    monkeypatch.setattr(manager.storage, "prepare", prepare)
    request = asyncio.create_task(client.post("/api/runs", json={"scenarioId": "paint-draw-poster", "prompt": "Draw"}))
    await entered.wait()
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    assert len(app.state.start_requests) == 1
    release.set()
    detail = await manager.get_active_run_detail()
    assert detail["run"]["status"] == "running"
    await manager.stop_run(detail["run"]["id"])


def test_lifetime_lease_excludes_another_backend_and_releases():
    first = BackendLease(port=0)
    first.acquire()
    port = first.socket.getsockname()[1]
    second = BackendLease(port=port)
    try:
        with pytest.raises(Exception, match="already running"):
            second.acquire()
    finally:
        first.close()
    second.acquire()
    second.close()


@pytest.mark.parametrize("value", [True, False])
async def test_obsolete_verification_option_is_rejected_before_allocating_a_run(api, value):
    _, manager, client = api
    response = await client.post("/api/runs", json={"scenarioId": "paint-draw-poster", "prompt": "Draw",
                                                  "verificationEnabled": value})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"
    assert not manager.storage.root.exists()


@pytest.mark.parametrize("version", [1, 2, 4])
async def test_unsupported_saved_replay_returns_409_without_modifying_history(api, version):
    _, manager, client = api
    detail = await manager.start_run({"scenarioId": "paint-draw-poster", "prompt": "Draw"})
    run_id = detail["run"]["id"]
    await manager.stop_run(run_id)
    replay_path = manager.storage.run_dir(run_id) / "replay.json"
    stored = json.loads(replay_path.read_text())
    assert stored["version"] == 3
    stored["version"] = version
    stored["run"]["verificationEnabled"] = True
    stored["run"]["summary"].update(verificationPassed=True, outcome="success")
    replay_path.write_text(json.dumps(stored, indent=2))
    original = replay_path.read_bytes()
    manager.contexts.pop(run_id)
    for suffix in ("", "/replay", "/events"):
        response = await client.get(f"/api/runs/{run_id}{suffix}")
        assert response.status_code == 409
        assert response.json()["code"] == "unsupported_replay_version"
        assert replay_path.read_bytes() == original
