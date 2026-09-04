"""The runner's camelCase HTTP and version-3 replay contracts.

Optional properties are omitted on the wire. Start requests reject unknown fields.
"""
import re
from datetime import datetime
from types import UnionType
from typing import Annotated, Any, Literal, TypeVar, Union, get_args, get_origin

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

Text = Annotated[str, Field(min_length=1)]
Count = Annotated[int, Field(ge=0)]
Positive = Annotated[int, Field(gt=0)]
TurnBudget = Annotated[int, Field(gt=0, le=50)]
LabId = Literal["kanban", "paint", "booking"]
BrowserMode = Literal["headless", "headful"]
RunStatus = Literal["running", "completed", "failed", "cancelled"]
EventType = Literal[
    "run_started", "workspace_prepared", "lab_started", "browser_session_started", "browser_navigated",
    "function_call_requested", "function_call_completed", "screenshot_captured", "run_progress",
    "run_completed", "run_failed", "run_cancelled",
]


def is_integer_annotation(annotation: Any) -> bool:
    if annotation is int:
        return True
    if get_origin(annotation) is Annotated:
        return is_integer_annotation(get_args(annotation)[0])
    return get_origin(annotation) in (Union, UnionType) and any(is_integer_annotation(part) for part in get_args(annotation))


class WireModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore", strict=True)

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value: Any) -> Any:
        if isinstance(value, dict):
            known = set(cls.model_fields) | {field.alias for field in cls.model_fields.values()}
            if any(item is None for key, item in value.items() if key in known):
                raise ValueError("Optional properties must be omitted, not null.")
            value = dict(value)
            for name, field in cls.model_fields.items():
                for key in (name, field.alias):
                    item = value.get(key)
                    if isinstance(item, float) and item.is_integer() and is_integer_annotation(field.annotation):
                        value[key] = int(item)
        return value

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True, mode="json")


def valid_timestamp(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z", value):
        raise ValueError("Timestamp must be a UTC ISO date ending in Z.")
    datetime.fromisoformat(value[:-1] + "+00:00")
    return value


class ScenarioManifest(WireModel):
    id: Text
    lab_id: LabId
    category: Literal["productivity", "creativity", "commerce"]
    title: Text
    description: Text
    default_prompt: Text
    workspace_template_path: Text
    tags: Annotated[list[Text], Field(min_length=1)]


class RunSummary(WireModel):
    step_count: Count
    screenshot_count: Count
    notes: list[str]


class RunRecord(WireModel):
    id: Text
    scenario_id: Text
    lab_id: LabId
    browser_mode: BrowserMode
    model: Text
    max_response_turns: TurnBudget
    prompt: Text
    status: RunStatus
    started_at: str
    completed_at: str | None = None
    duration_ms: Count | None = None
    summary: RunSummary | None = None

    _dates = field_validator("started_at", "completed_at")(valid_timestamp)


class RunEvent(WireModel):
    id: Text
    run_id: Text
    sequence: Count
    type: EventType
    level: Literal["ok", "pending", "warn", "error"]
    message: Text
    detail: str | None = None
    created_at: str

    _date = field_validator("created_at")(valid_timestamp)


class BrowserViewport(WireModel):
    height: Positive
    width: Positive


class BrowserScreenshotArtifact(WireModel):
    source: Literal["browser_preview", "code_tool"] | None = None
    image_width: Positive | None = None
    image_height: Positive | None = None
    captured_at: str
    id: Text
    label: Text
    mime_type: Literal["image/png"]
    page_title: Text | None = None
    page_url: Text
    path: Text
    url: Text

    _date = field_validator("captured_at")(valid_timestamp)


class BrowserState(WireModel):
    current_url: Text
    mode: BrowserMode
    page_title: Text | None = None
    screenshots: list[BrowserScreenshotArtifact]
    target_label: Text
    viewport: BrowserViewport


class StartRunRequest(WireModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False, validate_by_name=False)
    scenario_id: Text
    browser_mode: BrowserMode | None = None
    max_response_turns: TurnBudget | None = None
    prompt: Text
    model: Text | None = None


class RunDetail(WireModel):
    run: RunRecord
    scenario: ScenarioManifest
    workspace_path: Text
    event_stream_url: Text
    replay_url: Text
    browser: BrowserState | None = None
    events: list[RunEvent]


class RunnerErrorResponse(WireModel):
    code: Text
    error: Text
    hint: Text | None = None


class BackendDefaults(WireModel):
    browser_mode: BrowserMode
    model: Text
    max_response_turns: TurnBudget


class BackendCapabilities(WireModel):
    backend_id: Literal["javascript", "python"]
    code_tool: Literal["exec_js", "exec_py"]
    browser_modes: Annotated[list[BrowserMode], Field(min_length=1)]
    defaults: BackendDefaults
    instance_id: Text

    @model_validator(mode="after")
    def consistent_backend(self) -> "BackendCapabilities":
        if self.backend_id == "python" and (self.code_tool != "exec_py" or self.browser_modes != ["headful"]):
            raise ValueError("Python supports exec_py with a visible browser only.")
        if self.backend_id == "javascript" and (self.code_tool != "exec_js" or self.browser_modes != ["headless", "headful"]):
            raise ValueError("JavaScript uses exec_js with headless and headful browser modes.")
        if self.defaults.browser_mode not in self.browser_modes:
            raise ValueError("Default browser mode must be supported.")
        return self


class ReplayArtifacts(WireModel):
    events_path: Text
    replay_path: Text
    run_path: Text
    screenshots_directory: Text
    workspace_path: Text


class ReplayBundle(WireModel):
    version: Literal[3]
    artifacts: ReplayArtifacts
    browser: BrowserState | None = None
    events: list[RunEvent]
    run: RunRecord
    scenario: ScenarioManifest


ModelType = TypeVar("ModelType", bound=WireModel)


def validate_wire(model: type[ModelType], value: Any) -> dict[str, Any]:
    return model.model_validate(value).wire()
