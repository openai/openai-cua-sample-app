import asyncio
import json
import os
import socket
import sys

import httpx
import pytest

CHILD = """
import asyncio
import sys
from pathlib import Path
import uvicorn
from app import __main__ as entry
from app.api import create_app
from app.runner import RunnerManager

root = Path(sys.argv[1])

async def execute(context):
    (root / "executing").touch()
    try:
        await asyncio.Event().wait()
    finally:
        (root / "cleaning").touch()
        await asyncio.sleep(0.2)
        (root / "cleaned").touch()

def test_app(*, settings):
    manager = RunnerManager(root / "data", executor=execute, settings=settings)
    return create_app(manager=manager, settings=settings, acquire_lease=False)

startup = uvicorn.Server.startup
async def ready(server, sockets=None):
    await startup(server, sockets)
    port = server.servers[0].sockets[0].getsockname()[1]
    (root / "port").write_text(str(port))

uvicorn.Server.startup = ready
entry.create_app = test_app
entry.main()
"""


@pytest.mark.parametrize("message", [None, b"stop"])
async def test_managed_parent_pipe_waits_for_active_run_cleanup(tmp_path, message):
    environment = {**os.environ, "CUA_MANAGED_LAUNCH": "1", "HOST": "127.0.0.1", "PORT": "0",
                   "OPENAI_API_KEY": ""}
    process = await asyncio.create_subprocess_exec(sys.executable, "-c", CHILD, str(tmp_path),
                                                   env=environment, stdin=asyncio.subprocess.PIPE,
                                                   stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    assert process.stdout is not None and process.stdin is not None
    output = asyncio.create_task(process.stdout.read())
    try:
        for _ in range(200):
            if (tmp_path / "port").exists():
                break
            assert process.returncode is None, (await output).decode()
            await asyncio.sleep(0.025)
        port = (tmp_path / "port").read_text()
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", trust_env=False) as client:
            response = await client.post("/api/runs", json={"scenarioId": "paint-draw-poster", "prompt": "Draw"})
            assert response.status_code == 202
            run_id = response.json()["runId"]
        for _ in range(200):
            if (tmp_path / "executing").exists():
                break
            await asyncio.sleep(0.025)
        assert (tmp_path / "executing").exists()
        if message is None:
            process.stdin.close()
        else:
            process.stdin.write(message)
            await process.stdin.drain()
        assert await asyncio.wait_for(process.wait(), timeout=5) == 0, (await output).decode()
        assert (tmp_path / "cleaning").exists()
        assert (tmp_path / "cleaned").exists()
        replay = json.loads((tmp_path / "data" / "runs" / run_id / "replay.json").read_text())
        assert replay["run"]["status"] == "cancelled"
        assert replay["events"][-1]["type"] == "run_cancelled"
        assert sum(event["type"] == "run_cancelled" for event in replay["events"]) == 1
    finally:
        process.stdin.close()
        if process.returncode is None:
            process.kill()
            await process.wait()
        await output


async def test_managed_startup_failure_exits_with_parent_pipe_still_open(tmp_path):
    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        environment = {**os.environ, "CUA_MANAGED_LAUNCH": "1", "HOST": "127.0.0.1",
                       "PORT": str(occupied.getsockname()[1]), "OPENAI_API_KEY": ""}
        process = await asyncio.create_subprocess_exec(sys.executable, "-c", CHILD, str(tmp_path),
                                                       env=environment, stdin=asyncio.subprocess.PIPE,
                                                       stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        assert process.stdout is not None and process.stdin is not None
        output = asyncio.create_task(process.stdout.read())
        try:
            assert await asyncio.wait_for(process.wait(), timeout=5) != 0
            assert not (tmp_path / "port").exists()
        finally:
            process.stdin.close()
            if process.returncode is None:
                process.kill()
                await process.wait()
            await output
