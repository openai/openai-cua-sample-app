import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app import models

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((ROOT / "contracts/fixtures.json").read_text())
MODELS = {
    "startRunRequestSchema": models.StartRunRequest,
    "browserScreenshotArtifactSchema": models.BrowserScreenshotArtifact,
    "runEventSchema": models.RunEvent,
    "runRecordSchema": models.RunRecord,
    "backendCapabilitiesSchema": models.BackendCapabilities,
    "runnerErrorResponseSchema": models.RunnerErrorResponse,
    "replayBundleSchema": models.ReplayBundle,
}


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda item: item["name"])
def test_shared_wire_contract(fixture):
    model = MODELS[fixture["schema"]]
    if not fixture["valid"]:
        with pytest.raises(ValidationError):
            models.validate_wire(model, fixture["value"])
        return
    value = models.validate_wire(model, fixture["value"])
    assert value == fixture["value"]


@pytest.mark.parametrize("key,value", [("maxResponseTurns", True), ("verificationEnabled", 1),
                                      ("model", None), ("browserMode", None)])
def test_request_does_not_coerce_types_or_null(key, value):
    with pytest.raises(ValidationError):
        models.StartRunRequest.model_validate({"scenarioId": "paint-draw-poster", "prompt": "Draw", key: value})
