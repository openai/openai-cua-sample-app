"""Run artifacts with one atomically replaced replay as the committed snapshot."""
import asyncio
import copy
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from .errors import RunnerCoreError
from .models import ReplayBundle, validate_wire


async def run_in_thread(function):
    """Do not release admission/write locks while cancelled filesystem work runs."""
    task = asyncio.create_task(asyncio.to_thread(function))
    cancelled = False
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            cancelled = True
            if task.done():
                result = await task
                break
    if cancelled:
        raise asyncio.CancelledError
    return result


def validate_run_id(run_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", run_id):
        raise RunnerCoreError("Invalid run ID.", code="invalid_request", status_code=400,
                              hint="Use the run ID returned when starting a run.")
    return run_id


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_name(f"{path.name}.{uuid4()}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class RunStorage:
    def __init__(self, data_root: Path):
        self.root = data_root.resolve()

    def run_dir(self, run_id: str) -> Path:
        return self.root / "runs" / validate_run_id(run_id)

    def workspace(self, run_id: str) -> Path:
        return self.root / "workspaces" / validate_run_id(run_id)

    async def prepare(self, run_id: str, template: str) -> None:
        def prepare() -> None:
            for name in ("runs", "workspaces"):
                (self.root / name).mkdir(parents=True, exist_ok=True)
            target = self.workspace(run_id)
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(template, target)
            run_dir = self.run_dir(run_id)
            (run_dir / "screenshots").mkdir(parents=True, exist_ok=True)
            (run_dir / "events.jsonl").write_text("", encoding="utf-8")
        await run_in_thread(prepare)

    def replay(self, detail: dict) -> dict:
        run_dir = self.run_dir(detail["run"]["id"])
        return {
            "version": 3,
            "artifacts": {"eventsPath": str(run_dir / "events.jsonl"),
                          "replayPath": str(run_dir / "replay.json"),
                          "runPath": str(run_dir / "run.json"),
                          "screenshotsDirectory": str(run_dir / "screenshots"),
                          "workspacePath": detail["workspacePath"]},
            "events": copy.deepcopy(detail["events"]), "run": copy.deepcopy(detail["run"]),
            "scenario": copy.deepcopy(detail["scenario"]),
            **({"browser": copy.deepcopy(detail["browser"])} if "browser" in detail else {}),
        }

    async def persist(self, detail: dict, event: dict | None = None) -> None:
        snapshot = self.replay(detail)
        run_dir = self.run_dir(detail["run"]["id"])

        def write() -> None:
            run_dir.mkdir(parents=True, exist_ok=True)
            if event is not None:
                with (run_dir / "events.jsonl").open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(event, ensure_ascii=False) + "\n")
            atomic_json(run_dir / "run.json", snapshot["run"])
            # Published last: readers never combine an old record with newer events.
            atomic_json(run_dir / "replay.json", snapshot)
        await run_in_thread(write)

    async def read_replay(self, run_id: str) -> dict:
        path = self.run_dir(run_id) / "replay.json"
        try:
            text = await asyncio.to_thread(path.read_text, encoding="utf-8")
            value = json.loads(text)
            if not isinstance(value, dict):
                raise TypeError("Malformed replay bundle.")
            if value.get("version") != 3:
                raise RunnerCoreError(
                    f"Replay version {value.get('version', 'missing')} is not supported by this app.",
                    code="unsupported_replay_version", status_code=409,
                    hint="This app reads replay version 3. Keep the original file and use the matching app version to inspect it.",
                )
            return validate_wire(ReplayBundle, value)
        except (OSError, ValueError, TypeError) as error:
            raise RunnerCoreError(f"Run {run_id} was not found.", code="run_not_found", status_code=404,
                                  hint="Start a new run or check that the replay artifacts still exist on disk.") from error
