import asyncio
import copy
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException

from .config import Settings
from .errors import RunnerCoreError
from .lease import BackendLease
from .runner import RunnerManager
from .storage import validate_run_id

logger = logging.getLogger(__name__)


class OriginGuard:
    def __init__(self, app: Any, *, allowed_origins: set[str]):
        self.app = app
        self.allowed_origins = allowed_origins

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin-1"): value.decode("latin-1") for key, value in scope["headers"]}
        origin = headers.get("origin")

        async def with_cors(message: Any) -> None:
            if message["type"] == "http.response.start":
                response_headers = list(message.get("headers", []))
                response_headers.append((b"vary", b"Origin"))
                if origin in self.allowed_origins:
                    response_headers.extend([(b"access-control-allow-origin", origin.encode()),
                                             (b"access-control-allow-headers", b"Content-Type,X-CUA-Backend,Last-Event-ID"),
                                             (b"access-control-allow-methods", b"GET,POST,OPTIONS")])
                message = {**message, "headers": response_headers}
            await send(message)
        if origin and origin not in self.allowed_origins:
            await JSONResponse({"code": "origin_not_allowed", "error": "This origin is not allowed to access the runner.",
                                "hint": "Use the local operator console or configure CUA_ALLOWED_ORIGINS."}, status_code=403)(scope, receive, with_cors)
            return
        expected = headers.get("x-cua-backend")
        if expected is not None and expected != "python":
            await JSONResponse({"code": "backend_mismatch", "error": "The selected backend does not match the running backend.",
                                "hint": "Restart the console for the selected backend."}, status_code=409)(scope, receive, with_cors)
            return
        if scope["method"] == "OPTIONS":
            await Response(status_code=204)(scope, receive, with_cors)
            return
        await self.app(scope, receive, with_cors)


def create_app(*, manager: RunnerManager | None = None, settings: Settings | None = None,
               allowed_origins: list[str] | None = None, acquire_lease: bool = True) -> FastAPI:
    settings = settings or Settings.from_environment()
    manager = manager or RunnerManager(settings=settings)
    shutdown = asyncio.Event()
    lease = BackendLease()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if acquire_lease:
            lease.acquire()
        try:
            yield
        finally:
            try:
                await manager.shutdown()
            finally:
                shutdown.set()
                lease.close()

    app = FastAPI(lifespan=lifespan)
    app.state.manager = manager
    app.state.shutdown = shutdown
    app.state.lease = lease
    app.state.instance_id = os.environ.get("CUA_INSTANCE_ID") or str(uuid4())
    app.state.start_requests = set()
    defaults = {f"{protocol}://{host}:3000" for protocol in ("http", "https")
                for host in ("localhost", "127.0.0.1", "[::1]")}
    configured = allowed_origins if allowed_origins is not None else os.environ.get("CUA_ALLOWED_ORIGINS", "").split(",")
    app.add_middleware(OriginGuard, allowed_origins=defaults | {value.strip() for value in configured if value.strip()})

    @app.exception_handler(RunnerCoreError)
    async def runner_error(request: Request, error: RunnerCoreError) -> JSONResponse:
        return JSONResponse(error.envelope(), status_code=error.status_code)

    @app.exception_handler(ValidationError)
    @app.exception_handler(RequestValidationError)
    @app.exception_handler(json.JSONDecodeError)
    async def invalid_request(request: Request, error: Exception) -> JSONResponse:
        return JSONResponse({"code": "invalid_request", "error": str(error),
                             "hint": "Review the request payload against the published contracts."}, status_code=400)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        return JSONResponse({"code": "invalid_request", "error": str(error.detail)}, status_code=error.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception) -> JSONResponse:
        logger.error("Unexpected runner request error", exc_info=error)
        return JSONResponse({"code": "internal_runner_error", "error": "Internal runner error",
                             "hint": "Check the runner logs for the full stack trace."}, status_code=500)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "service": "runner"}

    @app.get("/api/capabilities")
    async def capabilities() -> dict:
        return {**settings.capabilities(), "instanceId": app.state.instance_id}

    @app.get("/api/scenarios")
    async def scenarios() -> list[dict]:
        return copy.deepcopy(manager.scenarios)

    @app.post("/api/scenarios/{scenario_id}/reset")
    async def reset(scenario_id: str) -> dict:
        return await manager.reset_scenario(scenario_id)

    @app.post("/api/runs", status_code=202)
    async def start(request: Request) -> dict:
        task = asyncio.create_task(manager.start_run(await request.json()))
        app.state.start_requests.add(task)
        def finished(done: asyncio.Task) -> None:
            app.state.start_requests.discard(done)
            if not done.cancelled():
                done.exception()  # Retrieve errors even if the HTTP caller disconnected.
        task.add_done_callback(finished)
        detail = await asyncio.shield(task)
        return {"detail": detail, "eventStreamUrl": detail["eventStreamUrl"], "replayUrl": detail["replayUrl"],
                "runId": detail["run"]["id"], "status": detail["run"]["status"]}

    @app.get("/api/runs/active")
    async def active() -> dict | None:
        return await manager.get_active_run_detail()

    @app.get("/api/runs/{run_id}")
    async def detail(run_id: str) -> dict:
        return await manager.get_run_detail(run_id)

    @app.post("/api/runs/{run_id}/stop")
    async def stop(run_id: str) -> dict:
        return await manager.stop_run(run_id)

    @app.get("/api/runs/{run_id}/replay")
    async def replay(run_id: str) -> dict:
        return await manager.get_replay_bundle(run_id)

    @app.get("/api/runs/{run_id}/artifacts/screenshots/{name}")
    async def screenshot(run_id: str, name: str) -> Response:
        validate_run_id(run_id)
        directory = (manager.storage.run_dir(run_id) / "screenshots").resolve()
        path = (directory / Path(name).name).resolve()
        try:
            if not path.is_relative_to(directory):
                raise FileNotFoundError(name)
            payload = await asyncio.to_thread(path.read_bytes)
            return Response(payload, media_type="image/png")
        except OSError as error:
            raise RunnerCoreError("Screenshot artifact not found", code="artifact_not_found", status_code=404,
                                  hint="Refresh the run detail and choose a screenshot that still exists on disk.") from error

    @app.get("/api/runs/{run_id}/events")
    async def events(run_id: str) -> StreamingResponse:
        snapshot = await manager.get_run_detail(run_id)
        queue: asyncio.Queue[dict] = asyncio.Queue()
        unsubscribe = None
        try:
            if snapshot["run"]["status"] == "running":
                # Subscribe before the second read; replay plus queue closes the gap.
                unsubscribe = manager.subscribe(run_id, queue.put_nowait)
                snapshot = await manager.get_run_detail(run_id)
        except BaseException:
            if unsubscribe:
                unsubscribe()
            raise

        async def stream():
            last_sequence = -1
            try:
                initial = list(snapshot["events"])
                while not queue.empty():
                    initial.append(queue.get_nowait())
                for event in sorted(initial, key=lambda item: item["sequence"]):
                    if event["sequence"] <= last_sequence:
                        continue
                    last_sequence = event["sequence"]
                    yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                    if event["type"] in ("run_completed", "run_cancelled", "run_failed"):
                        return
                if snapshot["run"]["status"] != "running":
                    return
                while not shutdown.is_set():
                    event_task = asyncio.create_task(queue.get())
                    shutdown_task = asyncio.create_task(shutdown.wait())
                    try:
                        done, _ = await asyncio.wait((event_task, shutdown_task), timeout=15,
                                                     return_when=asyncio.FIRST_COMPLETED)
                        if event_task in done:
                            event = event_task.result()
                            if event["sequence"] > last_sequence:
                                last_sequence = event["sequence"]
                                yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                                if event["type"] in ("run_completed", "run_cancelled", "run_failed"):
                                    return
                        elif shutdown_task in done:
                            return
                        else:
                            yield ": keepalive\n\n"
                    finally:
                        event_task.cancel()
                        shutdown_task.cancel()
                        await asyncio.gather(event_task, shutdown_task, return_exceptions=True)
            finally:
                if unsubscribe:
                    unsubscribe()
        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive"})

    return app
