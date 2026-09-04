import asyncio
import contextlib
import os
import signal
import sys
from pathlib import Path

import pytest

from app.desktop.runtime import PythonRuntimeError, launch_python_runtime

FIXTURES = Path(__file__).parent / "fixtures"


async def runtime(**kwargs):
    return await launch_python_runtime(
        python_path=sys.executable,
        worker_path=FIXTURES / "worker.py",
        release_helper_path=kwargs.pop("release_helper_path", FIXTURES / "release_inputs.py"),
        **kwargs,
    )


async def test_persistent_state_unicode_and_credential_isolation(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-do-not-pass")
    monkeypatch.setenv("OpenAI_Api_Key", "test-case-insensitive")
    session = await runtime()
    try:
        first = await session.execute("counter = 41\nprint(os.getpid())")
        pid = int(first["output"][0]["text"])
        assert (await session.execute("print(counter + 1, 'café 😀')"))["output"][0]["text"] == "42 café 😀\n"
        assert (await session.execute("print([k for k in os.environ if k.upper() == 'OPENAI_API_KEY'])"))["output"][0][
            "text"
        ] == "[]\n"
    finally:
        await session.close()
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
    with pytest.raises(PythonRuntimeError, match="closed"):
        await session.execute("print('late')")


async def test_deadline_kills_worker_before_single_input_release(tmp_path):
    helper = tmp_path / "release.py"
    marker = tmp_path / "released"
    session = await runtime(release_helper_path=helper, execution_timeout_ms=100)
    pid = session.child.pid
    helper.write_text(
        "import json, os\n"
        f"try: os.kill({pid}, 0)\n"
        "except ProcessLookupError: pass\n"
        "else: raise RuntimeError('worker is still alive')\n"
        f"with open({str(marker)!r}, 'a') as log: log.write('released\\n')\n"
        "print(json.dumps({'released': True}), flush=True)\n"
    )
    with pytest.raises(PythonRuntimeError, match="exceeded 100ms"):
        await session.execute("while True: pass")
    await asyncio.gather(session.close(), session.close())
    assert marker.read_text() == "released\n"


async def test_stop_remains_active_after_completed_operation():
    cancelled = asyncio.Event()
    session = await runtime(signal=cancelled)
    await session.execute("print('first')")
    executing = asyncio.create_task(session.execute("time.sleep(60)"))
    await asyncio.sleep(0.02)
    cancelled.set()
    with pytest.raises((asyncio.CancelledError, PythonRuntimeError)):
        await asyncio.wait_for(executing, 1)
    await asyncio.wait_for(session.close(), 1)


@pytest.mark.parametrize("mode", ["failure", "timeout"])
async def test_release_failures_remain_observable_on_repeated_close(tmp_path, mode):
    helper = tmp_path / "release.py"
    helper.write_text(
        "import time; time.sleep(60)"
        if mode == "timeout"
        else "import json; print(json.dumps({'error': 'Input permission revoked'})); raise SystemExit(1)"
    )
    session = await runtime(release_helper_path=helper, release_timeout_ms=100)
    await session.execute("print('ran')")
    for _ in range(2):
        with pytest.raises(PythonRuntimeError) as failure:
            await session.close()
        assert failure.value.code == f"input_release_{'timeout' if mode == 'timeout' else 'failed'}"


async def test_worker_cannot_be_spawned():
    with pytest.raises(PythonRuntimeError, match="Could not start local Python"):
        await launch_python_runtime(python_path="/missing-cua-python")


async def test_startup_permission_error_is_preserved(tmp_path):
    worker = tmp_path / "startup_error.py"
    worker.write_text(
        "import json\nprint(json.dumps({'error': 'Screen Recording permission is required.'}), flush=True)\nraise SystemExit(1)\n"
    )
    with pytest.raises(PythonRuntimeError, match="Screen Recording permission is required"):
        await launch_python_runtime(worker_path=worker, release_helper_path=FIXTURES / "release_inputs.py")


@pytest.mark.skipif(os.name == "nt", reason="POSIX process group ownership")
@pytest.mark.parametrize("detached", [False, True])
async def test_descendants_holding_pipes_cannot_block_close(detached):
    session = await runtime()
    descendant = None
    try:
        result = await session.execute(
            "import subprocess, sys\n"
            f"child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], start_new_session={detached})\n"
            "print(child.pid)"
        )
        descendant = int(result["output"][0]["text"])
        with pytest.raises(PythonRuntimeError, match="exited|closed"):
            await asyncio.wait_for(session.execute("os._exit(2)"), 2)
        await asyncio.wait_for(session.close(), 1)
        if detached:
            os.kill(descendant, 0)  # A separate group cannot keep our handles open.
        fresh = await runtime()
        try:
            assert (await fresh.execute("print('fresh')"))["output"][0]["text"] == "fresh\n"
        finally:
            await fresh.close()
    finally:
        if descendant:
            with contextlib.suppress(ProcessLookupError):
                os.kill(descendant, signal.SIGKILL)
        await session.close()


@pytest.mark.parametrize("response", ["[]", "{broken", '{"id": 999, "output": []}', '{"output": []}'])
async def test_invalid_worker_protocol_is_terminal(tmp_path, response):
    worker = tmp_path / "bad.py"
    worker.write_text(
        "import json, sys\nprint(json.dumps({'ready': True, 'platform': sys.platform}), flush=True)\n"
        f"for line in sys.stdin: print({response!r}, flush=True)\n"
    )
    session = await launch_python_runtime(
        worker_path=worker,
        release_helper_path=FIXTURES / "release_inputs.py",
    )
    with pytest.raises(PythonRuntimeError, match="invalid JSON or response ID"):
        await session.execute("print('x')")
    await session.close()


async def test_readiness_does_not_release_input_without_executing(tmp_path):
    helper = tmp_path / "must-not-run.py"
    helper.write_text("raise RuntimeError('must not run')")
    session = await runtime(release_helper_path=helper)
    await session.close()
