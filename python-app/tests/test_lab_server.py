import asyncio

import httpx
import pytest

from app.lab_server import start_workspace_lab_server


async def test_workspace_http_serves_nested_assets_and_blocks_escape(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "index.html").write_text("lab")
    (workspace / "nested").mkdir()
    (workspace / "nested" / "style.css").write_text("body {}")
    (tmp_path / "secret").write_text("secret")
    (workspace / "linked").symlink_to(tmp_path / "secret")
    server = await start_workspace_lab_server(workspace_path=workspace)
    try:
        async with httpx.AsyncClient(trust_env=False) as client:
            response = await client.get(server.url_for())
            assert response.text == "lab"
            assert response.headers["cache-control"] == "no-store"
            assert (await client.get(server.url_for("nested/style.css"))).headers["content-type"] == "text/css"
            assert (await client.get(server.url_for("%2e%2e/secret"))).status_code == 404
            assert (await client.get(server.url_for("linked"))).status_code == 404
            assert (await client.post(server.url_for())).status_code == 405
    finally:
        await server.close()


async def test_close_drops_an_idle_http_connection(tmp_path):
    server = await start_workspace_lab_server(workspace_path=tmp_path)
    _, writer = await asyncio.open_connection("127.0.0.1", server.server.sockets[0].getsockname()[1])
    await asyncio.wait_for(server.close(), 1)
    writer.close()


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize("exists", [False, True])
async def test_workspace_http_head_omits_body_for_success_and_error(tmp_path, method, exists):
    payload = b"lab" if exists else b'{"error":"Lab asset not found"}'
    if exists:
        (tmp_path / "asset.html").write_bytes(payload)
    server = await start_workspace_lab_server(workspace_path=tmp_path)
    writer = None
    try:
        reader, writer = await asyncio.open_connection(
            "127.0.0.1", server.server.sockets[0].getsockname()[1]
        )
        writer.write(f"{method} /asset.html HTTP/1.1\r\nHost: localhost\r\n\r\n".encode("ascii"))
        await writer.drain()
        response = await asyncio.wait_for(reader.read(), 2)
        headers, body = response.split(b"\r\n\r\n", 1)
        status = b"200 OK" if exists else b"404 Not Found"
        assert headers.startswith(b"HTTP/1.1 " + status)
        assert f"Content-Length: {len(payload)}".encode("ascii") in headers
        assert body == (b"" if method == "HEAD" else payload)
    finally:
        if writer:
            writer.close()
            await writer.wait_closed()
        await server.close()
