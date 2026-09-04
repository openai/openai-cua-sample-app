from typing import Any


class RunnerCoreError(Exception):
    def __init__(self, message: str, *, code: str = "runner_error", hint: str | None = None,
                 status_code: int = 500):
        super().__init__(message)
        self.code = code
        self.hint = hint
        self.status_code = status_code

    def envelope(self) -> dict[str, Any]:
        return {"code": self.code, "error": str(self), **({"hint": self.hint} if self.hint else {})}
