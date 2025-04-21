from computers import Computer
from utils import (
    create_response,
    show_image,
    pp,
    sanitize_message,
    check_blocklisted_url,
)
import json
from typing import Callable


class Agent:
    """
    A sample agent class that can be used to interact with a computer.

    (See simple_cua_loop.py for a simple example without an agent.)
    """

    def __init__(
        self,
        model="computer-use-preview",
        computer: Computer = None,
        tools: list[dict] = [],
        acknowledge_safety_check_callback: Callable = lambda: False,
    ):
        self.model = model
        self.computer = computer
        self.tools = tools
        self.print_steps = True
        self.debug = False
        self.show_images = False
        self.acknowledge_safety_check_callback = acknowledge_safety_check_callback

        if computer:
            self.tools += [
                {
                    "type": "computer-preview",
                    "display_width": computer.dimensions[0],
                    "display_height": computer.dimensions[1],
                    "environment": computer.environment,
                },
            ]

    def debug_print(self, *args):
        if self.debug:
            pp(*args)

    def handle_item(self, item):
        """Handle each item; may cause a computer action + screenshot."""
        if item["type"] == "message":
            if self.print_steps:
                print(item["content"][0]["text"])

        if item["type"] == "function_call":
            name, args = item["name"], json.loads(item["arguments"])
            if self.print_steps:
                print(f"{name}({args})")

            if hasattr(self.computer, name):  # if function exists on computer, call it
                method = getattr(self.computer, name)
                method(**args)
            return [
                {
                    "type": "function_call_output",
                    "call_id": item["call_id"],
                    "output": "success",  # hard-coded output for demo
                }
            ]

        if item["type"] == "computer_call":
            action = item["action"]
            action_type = action["type"]
            action_args = {k: v for k, v in action.items() if k != "type"}
            if self.print_steps:
                print(f"{action_type}({action_args})")

            method = getattr(self.computer, action_type)
            method(**action_args)

            screenshot_base64 = self.computer.screenshot()
            if self.show_images:
                show_image(screenshot_base64)

            # if user doesn't ack all safety checks exit with error
            pending_checks = item.get("pending_safety_checks", [])
            for check in pending_checks:
                message = check["message"]
                if not self.acknowledge_safety_check_callback(message):
                    raise ValueError(
                        f"Safety check failed: {message}. Cannot continue with unacknowledged safety checks."
                    )

            call_output = {
                "type": "computer_call_output",
                "call_id": item["call_id"],
                "acknowledged_safety_checks": pending_checks,
                "output": {
                    "type": "input_image",
                    "image_url": f"data:image/png;base64,{screenshot_base64}",
                },
            }

            # additional URL safety checks for browser environments
            if self.computer.environment == "browser":
                current_url = self.computer.get_current_url()
                check_blocklisted_url(current_url)
                call_output["output"]["current_url"] = current_url

            return [call_output]
        return []

    def run_full_turn(
        self, input_items, print_steps=True, debug=False, show_images=False
    ):
        self.print_steps = print_steps
        self.debug = debug
        self.show_images = show_images
        transcript: list[dict] = []  # keep for debugging/return
        pending: list[dict] = input_items.copy()  # start with user/system messages
        previous_response_id = None

        while True:
            self.debug_print([sanitize_message(msg) for msg in transcript + pending])

            # Deduplicate by id within this batch (API rejects duplicates).
            seen_ids: set[str] = set()
            payload: list[dict] = []
            for m in pending:
                mid = m.get("id") if isinstance(m, dict) else None
                if mid and mid in seen_ids:
                    continue
                if mid:
                    seen_ids.add(mid)
                payload.append(m)

            req = dict(
                model=self.model,
                input=payload,
                tools=self.tools,
                truncation="auto",
            )
            if previous_response_id:
                req["previous_response_id"] = previous_response_id

            response = create_response(**req)
            self.debug_print(response)

            previous_response_id = response.get("id")

            if "output" not in response:
                raise ValueError("No output from model")

            # prepare for next loop
            new_pending: list[dict] = []

            for item in response["output"]:
                t_type = item.get("type")

                if t_type == "computer_call":
                    # Execute call and collect observations to send next.
                    obs = self.handle_item(item)
                    transcript.append(item)  # keep for local log
                    transcript.extend(obs)
                    new_pending.extend(obs)
                    # After a computer_call we immediately break to send obs.
                    break
                else:
                    transcript.append(item)
                    # assistant/user messages do not get re‑sent; rely on previous_response_id

            # Determine loop exit: if last transcript item is assistant with no further tool calls
            if new_pending and new_pending[-1].get("role") == "assistant":
                break

            pending = new_pending if new_pending else []

            # If there's nothing new to send (shouldn't happen), exit to avoid infinite loop
            if not pending:
                break

        return transcript
