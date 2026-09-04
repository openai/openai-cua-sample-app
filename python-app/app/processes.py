"""Owned subprocesses with bounded cancellation and independently closable pipes."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal as signals
from collections.abc import Awaitable, Mapping, Sequence
from typing import TypeVar, cast

T = TypeVar("T")


async def bounded(operation: Awaitable[T], seconds: float) -> T:
    """Apply a deadline even when the operation delays or suppresses cancellation."""
    task = asyncio.ensure_future(operation)
    try:
        done, _ = await asyncio.wait((task,), timeout=seconds)
        if done:
            return await task
        raise asyncio.TimeoutError()
    finally:
        if not task.done():
            task.cancel()
            task.add_done_callback(lambda future: None if future.cancelled() else future.exception())


def child_environment() -> dict[str, str]:
    """The model credential belongs only to the agent process."""
    return {
        key: value
        for key, value in os.environ.items()
        if key.upper() != "OPENAI_API_KEY"
    }


def assert_active(signal: asyncio.Event | None) -> None:
    if signal is not None and signal.is_set():
        raise asyncio.CancelledError("Run aborted.")


async def await_active(operation: Awaitable[T], signal: asyncio.Event | None = None) -> T:
    """Race the actual operation against Stop, and reject results arriving after Stop."""
    task = asyncio.ensure_future(operation)
    cancelled = asyncio.create_task(signal.wait()) if signal is not None else None
    try:
        assert_active(signal)
        if cancelled is None:
            return await task
        await asyncio.wait((task, cancelled), return_when=asyncio.FIRST_COMPLETED)
        assert_active(signal)
        return await task
    finally:
        if cancelled is not None:
            cancelled.cancel()
        if not task.done():
            task.cancel()
        # Consume cancellation without allowing an uncooperative operation to delay Stop.
        pending = [item for item in (task, cancelled) if item is not None]
        done, unfinished = await asyncio.wait(pending, timeout=1)
        for item in done:
            if not item.cancelled():
                item.exception()
        for item in unfinished:
            item.add_done_callback(lambda future: None if future.cancelled() else future.exception())


class _ProcessProtocol(asyncio.SubprocessProtocol):
    def __init__(self) -> None:
        self.stdout = asyncio.StreamReader(limit=12 * 1024 * 1024 + 1)
        self.stderr = asyncio.StreamReader(limit=64 * 1024)
        self.exited = asyncio.Event()
        self.writable = asyncio.Event()
        self.writable.set()
        self.error: Exception | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        process = cast(asyncio.SubprocessTransport, transport)
        for descriptor, reader in ((1, self.stdout), (2, self.stderr)):
            pipe = process.get_pipe_transport(descriptor)
            if pipe is not None:
                reader.set_transport(pipe)

    def pipe_data_received(self, fd: int, data: bytes) -> None:
        if fd == 1:
            self.stdout.feed_data(data)
        elif fd == 2:
            self.stderr.feed_data(data)

    def pipe_connection_lost(self, fd: int, exc: Exception | None) -> None:
        if fd == 0:
            self.error = exc or BrokenPipeError("Subprocess input closed.")
            self.writable.set()
            return
        reader = self.stdout if fd == 1 else self.stderr
        if exc is not None:
            reader.set_exception(exc)
        else:
            reader.feed_eof()

    def process_exited(self) -> None:
        self.exited.set()

    def pause_writing(self) -> None:
        self.writable.clear()

    def resume_writing(self) -> None:
        self.writable.set()


class _ProcessHandle:
    def __init__(self, transport: asyncio.SubprocessTransport, protocol: _ProcessProtocol):
        self.transport = transport
        self.protocol = protocol

    @property
    def pid(self) -> int:
        return self.transport.get_pid()

    @property
    def returncode(self) -> int | None:
        return self.transport.get_returncode()

    def kill(self) -> None:
        self.transport.kill()

    async def wait(self) -> int:
        await self.protocol.exited.wait()
        result = self.returncode
        assert result is not None
        return result


class OwnedProcess:
    """Retain the process handle independently of descendants inheriting its pipes.

    asyncio's usual Process.wait can wait for inherited stdout/stderr to close.
    A public subprocess protocol reports process_exited independently; its pipe
    transports can then be closed even if a detached child lives. The event loop
    creates the pipes, including the overlapped handles required on Windows.
    """

    def __init__(self, transport: asyncio.SubprocessTransport, protocol: _ProcessProtocol) -> None:
        self.process = _ProcessHandle(transport, protocol)
        self.stdout = protocol.stdout
        self.stderr = protocol.stderr
        self._transport = transport
        self._protocol = protocol
        self._stdin = cast(asyncio.WriteTransport, transport.get_pipe_transport(0))
        self._closing: asyncio.Task[None] | None = None

    @classmethod
    async def spawn(cls, command: Sequence[str], *, env: Mapping[str, str] | None = None) -> OwnedProcess:
        loop = asyncio.get_running_loop()
        protocol = _ProcessProtocol()
        transport, _ = await loop.subprocess_exec(
            lambda: protocol,
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=dict(env) if env is not None else child_environment(),
            start_new_session=os.name != "nt",
            close_fds=True,
        )
        return cls(transport, protocol)

    @property
    def pid(self) -> int:
        return self.process.pid

    async def write(self, payload: bytes) -> None:
        if self._closing is not None or self._protocol.error:
            raise self._protocol.error or BrokenPipeError("Subprocess is closed.")
        self._stdin.write(payload)
        await self._protocol.writable.wait()
        if self._protocol.error:
            raise self._protocol.error

    async def wait(self) -> int:
        return await self.process.wait()

    async def _close(self) -> None:
        try:
            # Kill the group even after the leader exits: its descendants may remain.
            if os.name != "nt":
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.pid, signals.SIGKILL)
            elif self.process.returncode is None:
                self.process.kill()
            await asyncio.wait_for(self.process.wait(), 1)
        except asyncio.TimeoutError as error:
            raise RuntimeError("Subprocess exit could not be confirmed within 1000ms.") from error
        finally:
            self._transport.close()

    async def close(self) -> None:
        if self._closing is None:
            self._closing = asyncio.create_task(self._close())
        await asyncio.shield(self._closing)


async def drain_tail(reader: asyncio.StreamReader, limit: int = 4000) -> bytes:
    tail = b""
    while chunk := await reader.read(4096):
        tail = (tail + chunk)[-limit:]
    return tail
