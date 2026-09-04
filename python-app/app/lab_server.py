"""Serve only the selected mutable lab workspace on an ephemeral loopback port."""
import asyncio
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit


class WorkspaceLabServer:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.server: asyncio.Server | None = None
        self.connections: set[asyncio.StreamWriter] = set()
        self.tasks: set[asyncio.Task] = set()
        self.closing = False

    def url_for(self, path: str = "index.html") -> str:
        assert self.server and self.server.sockets
        return f"http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}/{path.lstrip('/')}"

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if self.closing:
            writer.close()
            return
        self.connections.add(writer)
        task = asyncio.current_task()
        if task:
            self.tasks.add(task)
        try:
            header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
            method, target, _ = header.split(b"\r\n", 1)[0].decode("ascii").split(" ", 2)
            if method not in ("GET", "HEAD"):
                await self.respond(writer, 405, b"Method not allowed", "text/plain")
                return
            path = unquote(urlsplit(target).path)
            if path == "/":
                path = "/index.html"
            asset = (self.root / path.lstrip("/")).resolve()
            if not asset.is_relative_to(self.root) or not asset.is_file():
                raise FileNotFoundError(path)
            payload = await asyncio.to_thread(asset.read_bytes)
            mime = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
            await self.respond(writer, 200, payload, mime, head=method == "HEAD")
        except (ValueError, OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            if not writer.is_closing():
                await self.respond(writer, 404, b'{"error":"Lab asset not found"}', "application/json")
        finally:
            writer.close()
            self.connections.discard(writer)
            if task:
                self.tasks.discard(task)

    async def respond(self, writer: asyncio.StreamWriter, status: int, body: bytes, mime: str, *, head: bool = False) -> None:
        reason = {200: "OK", 404: "Not Found", 405: "Method Not Allowed"}[status]
        writer.write((f"HTTP/1.1 {status} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {len(body)}\r\n"
                      "Cache-Control: no-store\r\nConnection: close\r\n\r\n").encode("ascii"))
        if not head:
            writer.write(body)
        await writer.drain()

    async def close(self) -> None:
        self.closing = True
        if self.server:
            self.server.close()
        for writer in list(self.connections):
            writer.close()
        pending = list(self.tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        if self.server:
            await asyncio.wait_for(self.server.wait_closed(), 1)


async def start_workspace_lab_server(*, workspace_path: Path | str) -> WorkspaceLabServer:
    server = WorkspaceLabServer(Path(workspace_path))
    server.server = await asyncio.start_server(server.handle, "127.0.0.1", 0, limit=8192)
    return server
