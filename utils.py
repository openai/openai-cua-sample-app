from __future__ import annotations

import os
import json
import base64
import io
from io import BytesIO
from typing import Any, Dict
from urllib.parse import urlparse

from dotenv import load_dotenv
from PIL import Image

import openai


openai.api_key = os.getenv("OPENAI_API_KEY", openai.api_key)
if org := os.getenv("OPENAI_ORG"):
    openai.organization = org

BLOCKED_DOMAINS = [
    "maliciousbook.com",
    "evilvideos.com",
    "darkwebforum.com",
    "shadytok.com",
    "suspiciouspins.com",
    "ilanbigio.com",
]


def pp(obj):
    print(json.dumps(obj, indent=4))


def show_image(base_64_image):
    image_data = base64.b64decode(base_64_image)
    image = Image.open(BytesIO(image_data))
    image.show()


def calculate_image_dimensions(base_64_image):
    image_data = base64.b64decode(base_64_image)
    image = Image.open(io.BytesIO(image_data))
    return image.size


def sanitize_message(msg: dict) -> dict:
    """Return a copy of the message with image_url omitted for computer_call_output messages."""
    if msg.get("type") == "computer_call_output":
        output = msg.get("output", {})
        if isinstance(output, dict):
            sanitized = msg.copy()
            sanitized["output"] = {**output, "image_url": "[omitted]"}
            return sanitized
    return msg


def create_response(**kwargs: Any) -> Dict[str, Any]:
    """Wrapper around *openai.responses.create* with dict output.

    The original implementation issued a raw POST and returned ``response.json()``.
    Most call‑sites therefore expect a *plain dict* with keys like ``"output"``
    and ``"id"``.  The OpenAI SDK, however, returns a *pydantic* model.

    To stay backward‑compatible we convert the SDK object back to ``dict`` via
    its ``to_dict()``/``model_dump()`` helper before returning.  This way none
    of the downstream code needs to change its access pattern.
    """

    # The callers may or may not supply ``previous_response_id``.  The SDK
    # requires ``openai.NOT_GIVEN`` for omitted optional parameters instead of
    # plain ``None``.  Convert to the sentinel so that accidental "None"
    # doesn't override the continuation logic.
    if "previous_response_id" in kwargs and kwargs["previous_response_id"] is None:
        kwargs["previous_response_id"] = openai.NOT_GIVEN

    try:
        sdk_response = openai.responses.create(**kwargs)
    except openai.OpenAIError as e:  # pragma: no cover – network/credential errors only at runtime.
        # Mirror the old behaviour of printing status & body for debugging.
        print("Error while calling Responses API:", e)
        raise

    # Convert to dict for compatibility.
    if hasattr(sdk_response, "to_dict"):
        return sdk_response.to_dict()
    # Fallback – older versions expose ``model_dump``.
    if hasattr(sdk_response, "model_dump"):
        return sdk_response.model_dump()
    # As a last resort, expose the underlying ``__dict__``.
    return dict(sdk_response.__dict__)


def check_blocklisted_url(url: str) -> None:
    """Raise ValueError if the given URL (including subdomains) is in the blocklist."""
    hostname = urlparse(url).hostname or ""
    if any(
        hostname == blocked or hostname.endswith(f".{blocked}")
        for blocked in BLOCKED_DOMAINS
    ):
        raise ValueError(f"Blocked URL: {url}")
