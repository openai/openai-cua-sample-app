import copy
import json
from functools import lru_cache

from .config import DEFAULT_MODEL_DISPLAY_NAME, REPO_ROOT
from .models import ScenarioManifest, validate_wire


@lru_cache(maxsize=1)
def catalog() -> dict:
    return json.loads((REPO_ROOT / "labs" / "catalog.json").read_text(encoding="utf-8"))


def list_scenarios() -> list[dict]:
    return [validate_wire(ScenarioManifest, {**item, "workspaceTemplatePath": str(REPO_ROOT / "labs" / item["templateDirectory"])})
            for item in catalog()["scenarios"]]


def instructions(lab_id: str, current_url: str) -> str:
    definition = next(item for item in catalog()["scenarios"] if item["labId"] == lab_id)
    return "\n".join([
        f"You are operating a persistent Python/PyAutoGUI desktop session for a {DEFAULT_MODEL_DISPLAY_NAME} CUA demo harness.",
        "You must use the exec_py tool before you answer.",
        "Observe the current interface with pyautogui.screenshot(), then use PyAutoGUI mouse and keyboard controls. Coordinates refer to the full desktop screenshot.",
        f"The lab is already open at {current_url}.", *copy.deepcopy(definition["instructions"]),
    ])
