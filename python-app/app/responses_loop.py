"""The complete Responses API → Python tool → tool results → response loop."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import struct
import time
from typing import Any

from .errors import RunnerCoreError
from .processes import assert_active, await_active


class OpenAIResponsesClient:
    def __init__(self, api_key: str) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key)

    async def create(self, request: dict[str, Any], signal: asyncio.Event | None = None) -> dict[str, Any]:
        response = await await_active(self.client.responses.create(**request), signal)
        return response.model_dump(exclude_none=True)

    async def close(self) -> None:
        await self.client.close()


def create_default_responses_client() -> OpenAIResponsesClient:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RunnerCoreError(
            "OPENAI_API_KEY is required to run a lab.",
            code="missing_api_key",
            status_code=400,
            hint="Set OPENAI_API_KEY in the runner environment, then rerun the scenario.",
        )
    return OpenAIResponsesClient(key)


def build_code_tool_definitions(platform: str) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": "exec_py",
            "strict": True,
            "description": "Execute Python in the persistent PyAutoGUI desktop session for this run.",
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code"],
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "\n".join(
                            [
                                f"Python to execute on the local {platform} desktop. Python globals survive between calls.",
                                "Available globals: pyautogui, log(value), and display(image), accepting a Pillow image.",
                                "A visible Chromium window is already open to the lab. Start with display(pyautogui.screenshot()).",
                                "Use PyAutoGUI mouse and keyboard input. On macOS (darwin), use command hotkeys; elsewhere use ctrl.",
                                "Screenshots use the same coordinates as PyAutoGUI input, including on Retina displays. All coordinates refer to the full desktop screenshot.",
                                "Operate only the lab window. No Playwright objects are available. Do not change the PyAutoGUI fail-safe setting.",
                            ]
                        ),
                    }
                },
            },
        }
    ]


def invalid_response(message: str) -> RunnerCoreError:
    return RunnerCoreError(message, code="unexpected_model_response", status_code=400)


def classify_response(response: dict[str, Any]) -> dict[str, Any]:
    """Validate *all* output items before allowing any model code to execute."""
    if not isinstance(response, dict):
        raise invalid_response("Malformed Responses API response.")
    if response.get("status") != "completed" or response.get("error"):
        error = response.get("error")
        message = error.get("message", "") if isinstance(error, dict) else ""
        raise invalid_response(
            f"Responses API request did not complete (status: {response.get('status', 'missing')}). {message}".strip()
        )
    if not isinstance(response.get("id"), str) or not response["id"].strip():
        raise invalid_response("Responses API response ID is missing.")
    if not isinstance(response.get("output"), list):
        raise invalid_response("Responses API output is missing.")
    calls: list[dict[str, Any]] = []
    call_ids: set[str] = set()
    commentary: list[str] = []
    final: list[str] = []
    refusal: str | None = None
    for item in response["output"]:
        if not isinstance(item, dict):
            raise invalid_response("Malformed response output item.")
        if item.get("type") == "reasoning":
            continue
        if item.get("type") == "function_call":
            if item.get("name") != "exec_py":
                raise invalid_response(
                    f"Unexpected function call: {item.get('name', '<unknown>')}. Only exec_py is supported."
                )
            if "status" in item and item["status"] != "completed":
                raise invalid_response("The response contains an unfinished function call.")
            if not isinstance(item.get("call_id"), str) or not item["call_id"].strip():
                raise invalid_response("Function call ID is missing.")
            if item["call_id"] in call_ids:
                raise invalid_response(f"Duplicate function call ID: {item['call_id']}.")
            if not isinstance(item.get("arguments"), str):
                raise invalid_response("Function call arguments must be a JSON string.")
            try:
                args = json.loads(item["arguments"])
            except ValueError as error:
                raise invalid_response("Function call arguments are not valid JSON.") from error
            if not isinstance(args, dict) or set(args) != {"code"} or not isinstance(args.get("code"), str):
                raise invalid_response("exec_py requires a code string and no other arguments.")
            if not args["code"].strip() or len(args["code"].encode()) > 64 * 1024:
                raise invalid_response("Python code must be nonempty and at most 64 KiB.")
            call_ids.add(item["call_id"])
            calls.append({"call_id": item["call_id"], "arguments": item["arguments"], "code": args["code"]})
            continue
        if item.get("type") != "message":
            raise RunnerCoreError(
                f"Unsupported response output: {item.get('type')}. Only exec_py tool calls are supported.",
                code="unsupported_tool_response",
                status_code=400,
            )
        if (
            item.get("role") != "assistant"
            or not isinstance(item.get("content"), list)
            or ("status" in item and item["status"] != "completed")
        ):
            raise invalid_response("The response contains an invalid or unfinished assistant message.")
        if item.get("phase") not in (None, "commentary", "final_answer"):
            raise invalid_response("Unknown assistant message phase.")
        for part in item["content"]:
            if not isinstance(part, dict):
                raise invalid_response("Malformed assistant message content.")
            if part.get("type") == "refusal":
                text = part.get("refusal")
                refusal = text.strip() if isinstance(text, str) and text.strip() else "The model declined this task."
                continue
            if part.get("type") != "output_text" or not isinstance(part.get("text"), str):
                raise invalid_response("Unsupported assistant message content.")
            text = part["text"].strip()
            if text:
                (commentary if item.get("phase") == "commentary" else final).append(text)
    if refusal:
        raise RunnerCoreError(refusal, code="model_refusal", status_code=400)
    progress = "\n\n".join(commentary)
    if calls:
        return {"kind": "calls", "calls": calls, "commentary": progress}
    if final:
        return {"kind": "final", "text": "\n\n".join(final), "commentary": progress}
    if commentary:
        return {"kind": "commentary", "commentary": progress}
    raise invalid_response("Responses API returned no tool calls or nonempty final assistant message.")


async def execute_python_tool_call(context: Any, session: Any, call: dict[str, Any]) -> list[dict[str, Any]]:
    if session.execution is None:
        raise RuntimeError("Python runtime is unavailable. Run uv sync and start a new run.")
    await await_active(
        context.emit_event(
            {
                "detail": f"exec_py {call['arguments']}",
                "level": "pending",
                "message": "Function tool call received from the model.",
                "type": "function_call_requested",
            }
        ),
        context.signal,
    )
    result = await await_active(session.execution.execute(call["code"], context.signal), context.signal)
    assert_active(context.signal)
    for item in result["output"]:
        if item["type"] != "input_image":
            continue
        encoded = item["image_url"][len("data:image/png;base64,") :]
        image = base64.b64decode(encoded)
        observation: dict[str, Any] = {"base64": encoded}
        if len(image) >= 24 and image[:8] == b"\x89PNG\r\n\x1a\n":
            observation["width"], observation["height"] = struct.unpack(">II", image[16:24])
        await await_active(context.capture_screenshot(session, "Code tool image", observation), context.signal)
    await await_active(context.sync_browser_state(session), context.signal)
    await await_active(
        context.capture_screenshot(session, f"responses-code-turn-{time.time_ns() // 1_000_000}"), context.signal
    )
    await await_active(
        context.emit_event(
            {
                "detail": "exec_py",
                "level": "ok",
                "message": "Function tool call completed.",
                "type": "function_call_completed",
            }
        ),
        context.signal,
    )
    return result["output"] or [{"text": "exec_py completed with no output.", "type": "input_text"}]


async def run_responses_code_loop(
    context: Any,
    session: Any,
    instructions: str,
    max_response_turns: int,
    client: Any,
) -> dict[str, Any]:
    """Each iteration requests a response and sends all matching tool results back."""
    previous_response_id: str | None = None
    next_input: Any = context.detail["run"]["prompt"].strip()
    final_assistant_message: str | None = None
    for turn in range(1, max_response_turns + 1):
        assert_active(context.signal)
        request: dict[str, Any] = {
            "instructions": instructions,
            "input": next_input,
            "model": context.detail["run"]["model"],
            "parallel_tool_calls": False,
            "reasoning": {"effort": "low"},
            "truncation": "auto",
            "tools": build_code_tool_definitions(session.execution.platform),
        }
        if previous_response_id is not None:
            request["previous_response_id"] = previous_response_id
        response = await await_active(client.create(request, context.signal), context.signal)
        assert_active(context.signal)
        classified = classify_response(response)
        usage = response.get("usage") or {}
        reasoning = (usage.get("output_tokens_details") or {}).get("reasoning_tokens", 0)
        await await_active(
            context.emit_event(
                {
                    "detail": f"{response['id']} · {usage.get('input_tokens', 0)} in · {usage.get('output_tokens', 0)} out · {reasoning} reasoning",
                    "level": "ok",
                    "message": f"Responses API turn {turn} completed.",
                    "type": "run_progress",
                }
            ),
            context.signal,
        )
        previous_response_id = response["id"]
        if classified["commentary"]:
            await await_active(
                context.emit_event(
                    {
                        "type": "run_progress",
                        "level": "pending",
                        "message": "Model progress.",
                        "detail": classified["commentary"],
                    }
                ),
                context.signal,
            )
        if classified["kind"] == "final":
            final_assistant_message = classified["text"]
            break
        if classified["kind"] == "commentary":
            next_input = []
            continue
        tool_outputs = []
        for call in classified["calls"]:
            assert_active(context.signal)
            output = await execute_python_tool_call(context, session, call)
            assert_active(context.signal)
            tool_outputs.append({"call_id": call["call_id"], "output": output, "type": "function_call_output"})
        next_input = tool_outputs
    if final_assistant_message is None:
        raise RuntimeError(
            f"Responses API code loop exhausted the configured {max_response_turns}-turn budget without producing a final assistant message."
        )
    await await_active(
        context.emit_event(
            {
                "detail": final_assistant_message,
                "level": "ok",
                "message": "Model returned a final response.",
                "type": "run_progress",
            }
        ),
        context.signal,
    )
    return {
        "final_assistant_message": final_assistant_message,
        "notes": [
            "Executed the scenario through a live Responses API code loop.",
            f"Model final response: {final_assistant_message}",
        ],
    }
