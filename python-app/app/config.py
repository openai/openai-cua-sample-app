import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent


def load_environment() -> None:
    load_dotenv(REPO_ROOT / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    data_root: Path = APP_ROOT / "data"
    default_model: str = "gpt-5.6"
    host: str = "127.0.0.1"
    port: int = 4041

    @classmethod
    def from_environment(cls) -> "Settings":
        return cls(data_root=Path(os.environ.get("CUA_DATA_ROOT", APP_ROOT / "data")).resolve(),
                   default_model=os.environ.get("CUA_DEFAULT_MODEL", "gpt-5.6"),
                   host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "4041")))

    def capabilities(self) -> dict:
        return {"backendId": "python", "codeTool": "exec_py", "browserModes": ["headful"],
                "defaults": {"browserMode": "headful", "model": self.default_model,
                             "maxResponseTurns": 24}}
