"""Manage the desktop worker protocol, deadlines, and input-release lifecycle."""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
from pathlib import Path
from typing import Any

from ..processes import OwnedProcess, assert_active, await_active, child_environment, drain_tail


class PythonRuntimeError(RuntimeError):
    def __init__(self, error: Any, code: str = "python_operation_failed") -> None:
        if isinstance(error, dict):
            code = error.get("code", code)
            error = error.get("message", str(error))
        super().__init__(str(error))
        self.code = code


def read_output(result: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(result.get("output"), list):
        raise PythonRuntimeError("Python returned invalid tool output.")
    output = []
    for item in result["output"]:
        if isinstance(item, dict):
            if item.get("type") == "input_text" and isinstance(item.get("text"), str):
                output.append({"type": "input_text", "text": item["text"]})
                continue
            if (
                item.get("type") == "input_image"
                and isinstance(item.get("image_url"), str)
                and item["image_url"].startswith("data:image/png;base64,")
            ):
                output.append({"type": "input_image", "image_url": item["image_url"], "detail": "original"})
                continue
        raise PythonRuntimeError("Python returned an unsupported output item.")
    return output


class PythonRuntime:
    def __init__(
        self,
        child: OwnedProcess,
        *,
        python_path: str,
        release_helper_path: str,
        environment: dict[str, str],
        signal: asyncio.Event | None,
        execution_timeout_ms: int,
        release_timeout_ms: int,
    ) -> None:
        self.child = child
        self.platform = sys.platform
        self.python_path = python_path
        self.release_helper_path = release_helper_path
        self.environment = environment
        self.signal = signal
        self.execution_timeout_ms = execution_timeout_ms
        self.release_timeout_ms = release_timeout_ms
        self._sequence = 0
        self._busy = False
        self._input_may_be_held = False
        self._closing: asyncio.Task[None] | None = None
        self._stderr = asyncio.create_task(drain_tail(child.stderr))
        self._watcher = asyncio.create_task(self._watch())

    async def _watch(self) -> None:
        exited = asyncio.create_task(self.child.wait())
        cancelled = asyncio.create_task(self.signal.wait()) if self.signal is not None else None
        try:
            await asyncio.wait([exited] + ([cancelled] if cancelled else []), return_when=asyncio.FIRST_COMPLETED)
            # The execution/finally caller awaits the same stored failure.
            with contextlib.suppress(Exception):
                await self.close()
        finally:
            for task in (exited, cancelled):
                if task is not None:
                    task.cancel()

    async def _receive(
        self, expected_id: int | None, timeout_ms: int, signal: asyncio.Event | None = None
    ) -> dict[str, Any]:
        line_task = asyncio.create_task(self.child.stdout.readline())
        exit_task = asyncio.create_task(self.child.wait())
        try:

            async def read_line() -> bytes:
                await asyncio.wait((line_task, exit_task), return_when=asyncio.FIRST_COMPLETED)
                if line_task.done():
                    line = await line_task
                    if line:
                        return line
                if exit_task.done():
                    raise PythonRuntimeError("Python worker exited.")
                raise PythonRuntimeError("Python worker closed its output.")

            try:
                line = await asyncio.wait_for(await_active(read_line(), signal or self.signal), timeout_ms / 1000)
            except asyncio.TimeoutError as error:
                raise PythonRuntimeError(f"Python execution exceeded {timeout_ms}ms. Start a new run.") from error
            except (ValueError, asyncio.LimitOverrunError) as error:
                raise PythonRuntimeError("Python output exceeds 12 MiB.") from error
            if len(line) > 12 * 1024 * 1024:
                raise PythonRuntimeError("Python output exceeds 12 MiB.")
            try:
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise TypeError("Invalid response.")
                if expected_id is not None and value.get("id") != expected_id:
                    raise ValueError("Unexpected response ID.")
                if expected_id is None and "id" in value:
                    raise ValueError("Unexpected startup response ID.")
            except (TypeError, ValueError, UnicodeError) as error:
                raise PythonRuntimeError("Python worker returned invalid JSON or response ID.") from error
            if "error" in value:
                raise PythonRuntimeError(value["error"])
            return value
        finally:
            for task in (line_task, exit_task):
                task.cancel()
            await asyncio.gather(line_task, exit_task, return_exceptions=True)

    async def execute(self, code: str, signal: asyncio.Event | None = None) -> dict[str, Any]:
        if self._closing is not None:
            raise PythonRuntimeError("Python session closed.")
        if self._busy:
            raise PythonRuntimeError("A Python operation is already running.")
        if not isinstance(code, str) or not code.strip() or len(code.encode()) > 64 * 1024:
            raise PythonRuntimeError("Python code must be nonempty and at most 64 KiB.")
        self._busy = True
        try:
            assert_active(self.signal)
            assert_active(signal)
            self._sequence += 1
            self._input_may_be_held = True
            request = json.dumps({"id": self._sequence, "operation": "execute", "code": code}) + "\n"
            await await_active(self.child.write(request.encode()), signal or self.signal)
            value = await self._receive(self._sequence, self.execution_timeout_ms, signal)
            assert_active(self.signal)
            assert_active(signal)
            return {"output": read_output(value)}
        except BaseException:
            await self.close()
            raise
        finally:
            self._busy = False

    async def _release_inputs(self) -> None:
        try:
            helper = await OwnedProcess.spawn(
                [self.python_path, "-I", "-u", self.release_helper_path],
                env=self.environment,
            )
        except Exception as error:
            raise PythonRuntimeError(f"Could not start input release: {error}", "input_release_failed") from error
        stdout = asyncio.create_task(drain_tail(helper.stdout))
        stderr = asyncio.create_task(drain_tail(helper.stderr))
        try:
            try:
                await asyncio.wait_for(helper.wait(), self.release_timeout_ms / 1000)
            except asyncio.TimeoutError as error:
                raise PythonRuntimeError(
                    f"Input release exceeded {self.release_timeout_ms}ms.",
                    "input_release_timeout",
                ) from error
            # The helper may have spawned a process retaining pipes. Close those
            # handles before awaiting reader tasks, but preserve already-read data.
            await asyncio.sleep(0)
            await helper.close()
            result = json.loads(await stdout)
            if helper.process.returncode != 0 or result.get("released") is not True:
                raise ValueError(result.get("error", "Release was not acknowledged."))
        except PythonRuntimeError:
            raise
        except Exception as error:
            raise PythonRuntimeError(f"Input release failed: {error}", "input_release_failed") from error
        finally:
            await helper.close()
            await asyncio.gather(stdout, stderr, return_exceptions=True)

    async def _close(self) -> None:
        failure: Exception | None = None
        try:
            await self.child.close()
        except Exception as error:  # noqa: BLE001 - Input release must be attempted after any kill error.
            failure = error
        finally:
            await self._stderr
        # Always attempt release, even when worker termination cannot be confirmed.
        if self._input_may_be_held:
            await self._release_inputs()
        if failure is not None:
            raise failure

    async def close(self) -> None:
        if self._closing is None:
            self._closing = asyncio.create_task(self._close())
        await asyncio.shield(self._closing)


async def launch_python_runtime(
    *,
    signal: asyncio.Event | None = None,
    execution_timeout_ms: int = 60_000,
    python_path: str | None = None,
    worker_path: str | Path | None = None,
    release_helper_path: str | Path | None = None,
    release_timeout_ms: int = 3000,
) -> PythonRuntime:
    assert_active(signal)
    python_path = python_path or sys.executable
    directory = Path(__file__).parent
    environment = child_environment()
    try:
        child = await OwnedProcess.spawn(
            [python_path, "-u", str(worker_path or directory / "worker.py")], env=environment
        )
    except Exception as error:
        raise PythonRuntimeError(f"Could not start local Python: {error}. Run uv sync and restart the runner.") from error
    runtime = PythonRuntime(
        child,
        python_path=python_path,
        release_helper_path=str(release_helper_path or directory / "release_inputs.py"),
        environment=environment,
        signal=signal,
        execution_timeout_ms=execution_timeout_ms,
        release_timeout_ms=release_timeout_ms,
    )
    try:
        ready = await runtime._receive(None, 15_000)
        assert_active(signal)
        if ready.get("ready") is not True or not isinstance(ready.get("platform"), str):
            raise PythonRuntimeError("Python desktop did not initialize.")
        runtime.platform = ready["platform"]
        return runtime
    except BaseException:
        await runtime.close()
        raise
