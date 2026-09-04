"""Single-run lifecycle. A terminal status means teardown and persistence finished."""
import asyncio
import base64
import copy
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .config import Settings
from .errors import RunnerCoreError
from .models import (
    BrowserScreenshotArtifact,
    BrowserState,
    RunDetail,
    RunEvent,
    RunRecord,
    StartRunRequest,
    validate_wire,
)
from .storage import RunStorage, run_in_thread, validate_run_id

logger = logging.getLogger(__name__)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class InternalRun:
    detail: dict[str, Any]
    signal: asyncio.Event = field(default_factory=asyncio.Event)
    execution: asyncio.Task | None = None
    stopping: asyncio.Task | None = None
    finalizing: bool = False
    completion: dict | None = None
    subscribers: set[Callable[[dict], None]] = field(default_factory=set)
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RunnerManager:
    def __init__(self, data_root: Path | str | None = None, *, executor: Callable | None = None,
                 settings: Settings | None = None, scenarios: list[dict] | None = None):
        from .lab_catalog import list_scenarios
        self.settings = settings or Settings.from_environment()
        self.storage = RunStorage(Path(data_root or self.settings.data_root))
        self.executor = executor
        self.scenarios = scenarios if scenarios is not None else list_scenarios()
        self.contexts: dict[str, InternalRun] = {}
        self.active_id: str | None = None
        self.starting = False
        self.start_done = asyncio.Event()
        self.start_done.set()
        self.shutting_down = False
        self.desktop_recovery_required = False

    def scenario(self, scenario_id: str) -> dict:
        for scenario in self.scenarios:
            if scenario["id"] == scenario_id:
                return copy.deepcopy(scenario)
        raise RunnerCoreError(f"Unknown scenario: {scenario_id}", code="unknown_scenario", status_code=404,
                              hint="Pick a scenario from /api/scenarios before starting a run.")

    async def start_run(self, input: dict) -> dict:
        request = validate_wire(StartRunRequest, input)
        if self.desktop_recovery_required:
            raise RunnerCoreError("Desktop input cleanup failed. New runs are blocked.", code="desktop_cleanup_failed",
                                  status_code=503, hint="Release held keys and mouse buttons, check desktop input permissions, then restart the runner before starting another run.")
        if self.shutting_down:
            raise RunnerCoreError("Runner is shutting down.", code="runner_shutting_down", status_code=503,
                                  hint="Restart the runner before starting another run.")
        if request.get("browserMode") == "headless":
            raise RunnerCoreError("Local PyAutoGUI requires a visible browser.", code="visible_browser_required",
                                  status_code=400, hint="Use browserMode: headful for local PyAutoGUI execution.")
        scenario = self.scenario(request["scenarioId"])
        if self.starting or self.active_id:
            raise RunnerCoreError("A run is already active. Stop it before starting another run.", code="run_already_active",
                                  status_code=409, hint="Stop the active run before starting another scenario.")
        run_id = str(uuid4())
        record = validate_wire(RunRecord, {
            "id": run_id, "scenarioId": scenario["id"], "labId": scenario["labId"], "browserMode": "headful",
            "maxResponseTurns": request.get("maxResponseTurns", 24), "model": request.get("model", self.settings.default_model),
            "prompt": request["prompt"], "status": "running", "startedAt": timestamp(),
        })
        # Reserve admission before the first await, including workspace copying.
        self.starting = True
        self.start_done.clear()
        try:
            await self.storage.prepare(run_id, scenario["workspaceTemplatePath"])
            detail = validate_wire(RunDetail, {
                "run": record, "scenario": scenario, "workspacePath": str(self.storage.workspace(run_id)),
                "events": [], "eventStreamUrl": f"/api/runs/{run_id}/events", "replayUrl": f"/api/runs/{run_id}/replay",
            })
            context = InternalRun(detail=detail)
            self.contexts[run_id] = context
            self.active_id = run_id
            await self.storage.persist(detail)
            await self.emit_event(context, {"type": "run_started", "level": "ok", "message": f"Run {run_id} started.",
                                            "detail": f"{scenario['title']} · headful · {record['maxResponseTurns']} turns"})
            await self.emit_event(context, {"type": "workspace_prepared", "level": "ok",
                                            "message": "Workspace copied into mutable run directory.",
                                            "detail": detail["workspacePath"]})
            context.execution = asyncio.create_task(self._execute(context), name=f"run:{run_id}")
            return copy.deepcopy(detail)
        except BaseException:
            self.active_id = None
            self.contexts.pop(run_id, None)
            raise
        finally:
            self.starting = False
            self.start_done.set()

    async def get_run_detail(self, run_id: str) -> dict:
        validate_run_id(run_id)
        if run_id in self.contexts:
            return copy.deepcopy(self.contexts[run_id].detail)
        replay = await self.storage.read_replay(run_id)
        return validate_wire(RunDetail, {"run": replay["run"], "scenario": self.scenario(replay["run"]["scenarioId"]),
                                        "workspacePath": replay["artifacts"]["workspacePath"], "events": replay["events"],
                                        "eventStreamUrl": f"/api/runs/{run_id}/events", "replayUrl": f"/api/runs/{run_id}/replay",
                                        **({"browser": replay["browser"]} if "browser" in replay else {})})

    async def get_active_run_detail(self) -> dict | None:
        await self.start_done.wait()
        return await self.get_run_detail(self.active_id) if self.active_id else None

    async def get_replay_bundle(self, run_id: str) -> dict:
        return await self.storage.read_replay(run_id)

    def subscribe(self, run_id: str, subscriber: Callable[[dict], None]) -> Callable[[], None]:
        validate_run_id(run_id)
        context = self.contexts.get(run_id)
        if context is None:
            raise RunnerCoreError(f"Run {run_id} is not active in this process.", code="run_not_active", status_code=404,
                                  hint="Open the persisted run detail instead of the live event stream.")
        context.subscribers.add(subscriber)
        return lambda: context.subscribers.discard(subscriber)

    async def stop_run(self, run_id: str, reason: str = "Operator requested stop.") -> dict:
        validate_run_id(run_id)
        await self.start_done.wait()
        context = self.contexts.get(run_id)
        if context is None:
            persisted = await self.get_run_detail(run_id)
            if persisted["run"]["status"] == "running":
                raise RunnerCoreError(f"Run {run_id} exists on disk but is not active in this runner process.",
                                      code="run_not_active", status_code=409,
                                      hint="The run is no longer active in this process. Inspect the persisted replay bundle.")
            return persisted
        if context.stopping:
            return await asyncio.shield(context.stopping)
        if context.finalizing or context.detail["run"]["status"] != "running":
            if context.execution:
                await asyncio.shield(context.execution)
            return copy.deepcopy(context.detail)
        context.signal.set()
        # Set stopping before cancelling so the executor cannot release the slot.
        context.stopping = asyncio.create_task(self._finish_stop(context, reason))
        if context.execution:
            context.execution.cancel()
        return await asyncio.shield(context.stopping)

    async def _finish_stop(self, context: InternalRun, reason: str) -> dict:
        try:
            if context.execution:
                try:
                    await asyncio.shield(context.execution)
                except asyncio.CancelledError:
                    # Cancellation before the task's first instruction owns no resources.
                    pass
            if context.detail["run"]["status"] == "running":
                await self._terminal(context, "cancelled", {"notes": [reason]},
                                     {"detail": reason, "level": "warn", "message": "Run cancelled before completion.", "type": "run_cancelled"})
            return copy.deepcopy(context.detail)
        finally:
            if self.active_id == context.detail["run"]["id"]:
                self.active_id = None

    async def shutdown(self) -> None:
        self.shutting_down = True
        await self.start_done.wait()
        if self.active_id:
            await self.stop_run(self.active_id, "Runner shutting down.")

    async def reset_scenario(self, scenario_id: str) -> dict:
        self.scenario(scenario_id)
        await self.start_done.wait()
        state = {"scenarioId": scenario_id, "resetAt": timestamp()}
        if self.active_id and self.contexts[self.active_id].detail["run"]["scenarioId"] == scenario_id:
            stopped = await self.stop_run(self.active_id, "Scenario reset requested.")
            state["cancelledRunId"] = stopped["run"]["id"]
        return state

    async def _execute(self, internal: InternalRun) -> None:
        from .scenario_runtime import RunExecutionContext, execute_scenario
        context = RunExecutionContext(
            detail=internal.detail, signal=internal.signal,
            screenshot_directory=self.storage.run_dir(internal.detail["run"]["id"]) / "screenshots",
            emit_event=lambda event: self.emit_event(internal, event),
            capture_screenshot=lambda session, label, observation=None: self.capture_screenshot(internal, session, label, observation),
            sync_browser_state=lambda session: self.sync_browser_state(internal, session),
            complete_run=lambda **kwargs: self._complete(internal, **kwargs),
        )
        try:
            await (self.executor or execute_scenario)(context)
            if internal.signal.is_set():
                return
            internal.finalizing = True
            if not internal.completion:
                raise RuntimeError("Executor returned without completing the run.")
            await self._terminal(internal, "completed", internal.completion,
                                 {"detail": internal.detail["replayUrl"], "level": "ok",
                                  "message": "Run finished.", "type": "run_completed"})
        except (Exception, asyncio.CancelledError) as error:  # noqa: BLE001 - execution failures become persisted runs
            code = getattr(error, "code", "")
            cleanup_failed = code in ("desktop_cleanup_failed", "cleanup_failed")
            if code == "desktop_cleanup_failed":
                self.desktop_recovery_required = True
            if internal.signal.is_set() and not cleanup_failed:
                return
            internal.finalizing = True
            if code == "python_failsafe":
                await self._terminal(internal, "cancelled", {"notes": ["Desktop fail-safe activated."]},
                                     {"detail": code, "level": "warn", "message": "Desktop fail-safe activated. Run cancelled.", "type": "run_cancelled"})
            else:
                notes = [str(error) or type(error).__name__]
                if code:
                    notes.append(f"Error code: {code}")
                hint = getattr(error, "hint", None)
                if hint:
                    notes.append(f"Hint: {hint}")
                await self._terminal(internal, "failed", {"notes": notes},
                                     {"detail": " ".join(notes), "level": "error", "message": "Run failed during execution.", "type": "run_failed"})
        finally:
            if not internal.stopping and self.active_id == internal.detail["run"]["id"]:
                self.active_id = None

    async def _complete(self, context: InternalRun, *, notes: list[str]) -> None:
        if not context.signal.is_set() and context.detail["run"]["status"] == "running":
            context.completion = {"notes": notes}

    def _update_counts(self, detail: dict) -> None:
        if "summary" in detail["run"]:
            detail["run"]["summary"].update(stepCount=len(detail["events"]),
                                              screenshotCount=len(detail.get("browser", {}).get("screenshots", [])))

    def _event(self, context: InternalRun, event: dict) -> dict:
        sequence = len(context.detail["events"])
        return validate_wire(RunEvent, {**event, "id": f"{context.detail['run']['id']}:{sequence}",
                                       "runId": context.detail["run"]["id"], "sequence": sequence, "createdAt": timestamp()})

    def _notify(self, context: InternalRun, event: dict) -> None:
        for subscriber in list(context.subscribers):
            try:
                subscriber(copy.deepcopy(event))
            except Exception:
                logger.exception("Run subscriber failed")

    async def emit_event(self, context: InternalRun, input: dict, terminal_record: dict | None = None) -> None:
        async with context.write_lock:
            event = self._event(context, input)
            detail = copy.deepcopy(context.detail) if terminal_record else context.detail
            if terminal_record:
                detail["run"] = terminal_record
            detail["events"].append(event)
            self._update_counts(detail)
            await self.storage.persist(detail, event)
            if terminal_record:
                context.detail.clear()
                context.detail.update(detail)
            self._notify(context, event)

    async def _terminal(self, context: InternalRun, status: str, completion: dict, event: dict) -> None:
        end = timestamp()
        start = datetime.fromisoformat(context.detail["run"]["startedAt"].replace("Z", "+00:00"))
        duration = max(0, int((datetime.fromisoformat(end.replace("Z", "+00:00")) - start).total_seconds() * 1000))
        record = {**context.detail["run"], "status": status, "completedAt": end, "durationMs": duration,
                  "summary": {**completion, "screenshotCount": 0, "stepCount": 0}}
        try:
            await self.emit_event(context, event, record)
        except Exception as error:
            if status == "completed":
                raise
            # Disk failure must not strand the desktop slot or a live SSE client.
            logger.exception("Could not persist terminal run")
            record["status"] = "failed"
            record["summary"].update(notes=[*completion["notes"], f"Run artifacts could not be persisted: {error}"])
            context.detail["run"] = record
            failure = self._event(context, {"detail": str(error), "level": "error", "type": "run_failed",
                                            "message": "Run artifacts could not be persisted."})
            context.detail["events"].append(failure)
            self._update_counts(context.detail)
            self._notify(context, failure)

    async def capture_screenshot(self, context: InternalRun, session: Any, label: str, observation: dict | None = None) -> dict:
        if observation:
            identifier = f"observation-{uuid4()}"
            path = self.storage.run_dir(context.detail["run"]["id"]) / "screenshots" / f"{identifier}.png"
            await run_in_thread(lambda: path.write_bytes(base64.b64decode(observation["base64"])))
            snapshot = {**await session.read_state(), "id": identifier, "label": label, "path": str(path),
                        "mimeType": "image/png", "capturedAt": timestamp()}
        else:
            snapshot = await session.capture_screenshot(label)
        artifact = {"id": snapshot["id"], "label": snapshot["label"], "path": str(snapshot["path"]),
                    "mimeType": snapshot["mimeType"], "capturedAt": snapshot["capturedAt"],
                    "pageUrl": snapshot["currentUrl"], "source": "code_tool" if observation else "browser_preview",
                    "url": f"/api/runs/{context.detail['run']['id']}/artifacts/screenshots/{Path(snapshot['path']).name}"}
        if snapshot.get("pageTitle"):
            artifact["pageTitle"] = snapshot["pageTitle"]
        dimensions = observation or session.viewport
        for source, target in (("width", "imageWidth"), ("height", "imageHeight")):
            if dimensions.get(source):
                artifact[target] = dimensions[source]
        artifact = validate_wire(BrowserScreenshotArtifact, artifact)
        context.detail["browser"] = self._browser_state(context, session, snapshot)
        context.detail["browser"]["screenshots"].append(artifact)
        await self.emit_event(context, {"detail": artifact["url"], "level": "ok", "type": "screenshot_captured",
                                        "message": f"Screenshot captured ({label})."})
        return artifact

    def _browser_state(self, context: InternalRun, session: Any, state: dict) -> dict:
        return validate_wire(BrowserState, {"currentUrl": state["currentUrl"], "mode": session.mode,
                              "screenshots": context.detail.get("browser", {}).get("screenshots", []),
                              "targetLabel": session.target_label, "viewport": session.viewport,
                              **({"pageTitle": state["pageTitle"]} if state.get("pageTitle") else {})})

    async def sync_browser_state(self, context: InternalRun, session: Any) -> None:
        state = await session.read_state()
        async with context.write_lock:
            context.detail["browser"] = self._browser_state(context, session, state)
            await self.storage.persist(context.detail)
