import json
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent
_defaults = json.loads((REPO_ROOT / "contracts" / "defaults.json").read_text(encoding="utf-8"))
DEFAULT_MODEL: str = _defaults["model"]
DEFAULT_MODEL_DISPLAY_NAME: str = _defaults["modelDisplayName"]


def load_environment() -> None:
    load_dotenv(REPO_ROOT / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    data_root: Path = APP_ROOT / "data"
    default_model: str = DEFAULT_MODEL
    host: str = "127.0.0.1"
    port: int = 4041

    @classmethod
    def from_environment(cls) -> "Settings":
        return cls(data_root=Path(os.environ.get("CUA_DATA_ROOT", APP_ROOT / "data")).resolve(),
                   default_model=os.environ.get("CUA_DEFAULT_MODEL", DEFAULT_MODEL),
                   host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "4041")))

    def capabilities(self) -> dict:
        return {"backendId": "python", "codeTool": "exec_py", "browserModes": ["headful"],
                "defaults": {"browserMode": "headful", "model": self.default_model,
                             "maxResponseTurns": 24}}
