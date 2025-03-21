import json
from typing import Callable, List
from computers import Computer
from utils import (
    create_response,
    show_image,
    pp,
    sanitize_message,
)

class Agent:
    """
    A sample agent class that can be used to interact with a computer.
    """

    def __init__(
        self,
        model="computer-use-preview",
        computer: Computer = None,
        tools: List[dict] = [],
        acknowledge_safety_check_callback: Callable = lambda message: False,
    ):
        self.model = model
        self.computer = computer
        self.tools = tools
        self.print_steps = True
        self.debug = False
        self.show_images = False
        self.acknowledge_safety_check_callback = acknowledge_safety_check_callback

        if computer:
            dimensions = computer.get_dimensions()
            self.tools += [
                {
                    "type": "computer-preview",
                    "display_width": dimensions[0],
                    "display_height": dimensions[1],
                    "environment": computer.environment,
                },
            ]

    def debug_print(self, *args):
        if self.debug:
            pp(*args)

    @staticmethod
    def format_status_message(action: str, args: dict) -> dict:
        """
        Converts a method call such as open_app with its arguments into a JSON message.
        For example, for open_app it returns:
          { "action": { "type": "open_app", "description": "Opened <app name>" } }
        """
        if action == "open_app":
            description = f"Opened `{args.get('app_name')}`"
        elif action == "click":
            description = f"Clicked at `({args.get('x')}, {args.get('y')})`"
        elif action == "double_click":
            description = f"Double clicked at `({args.get('x')}, {args.get('y')})`"
        elif action == "scroll":
            direction = "up" if args.get('scroll_y') < 0 else "down"
            description = f"Scrolled {direction} at `({args.get('x')}, {args.get('y')})`"
        elif action == "type":
            description = f"Typed `{args.get('text')}`"
        # elif action == "wait":
        #     description = f"Waited for {args.get('ms', 1000)} ms"
        elif action == "move":
            description = f"Moved to `({args.get('x')}, {args.get('y')})`"
        elif action == "keypress":
            keys = args.get('keys', [])
            description = f"Pressed `{'+'.join(keys)}`"
        elif action == "drag":
            path = args.get('path', [])
            description = f"Dragged"
        elif action == "screenshot":
            description = "Took a screenshot"
        else:
            description = "Performed action"
        return {"action": {"type": action, "description": description}}

    def handle_item(self, item, status_callback: Callable[[dict], None] = None):
        """Handle each item; may cause a computer action plus (optional) status callback messages."""
        if item["type"] == "message":
            if self.print_steps:
                # Assumes item["content"] is a list of dicts with a "text" key.
                print(item["content"][0]["text"])
            status_callback({"message": item["content"][0]["text"]})
            return []

        if item["type"] == "function_call":
            name = item["name"]
            args = json.loads(item["arguments"])
            # Call the status callback (if provided) with a formatted message.
            if status_callback and name != "wait":
                status_callback(Agent.format_status_message(name, args))
            if self.print_steps:
                print(f"{name}({args})")
            if hasattr(self.computer, name):  # if function exists on computer, call it
                method = getattr(self.computer, name)
                output = method(**args)
            else:
                output = None
            return [
                {
                    "type": "function_call_output",
                    "call_id": item["call_id"],
                    "output": output,
                }
            ]

        if item["type"] == "computer_call":
            action = item["action"]
            action_type = action["type"]
            action_args = {k: v for k, v in action.items() if k != "type"}
            # Call the status callback (if provided) with a formatted message.
            if status_callback and action_type != "wait":
                status_callback(Agent.format_status_message(action_type, action_args))
            if self.print_steps:
                print(f"{action_type}({action_args})")
            method = getattr(self.computer, action_type)
            method(**action_args)

            screenshot_base64 = self.computer.screenshot()
            if self.show_images:
                show_image(screenshot_base64)

            # If there are pending safety checks, they must be acknowledged.
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
            return [call_output]

        return []

    def run_full_turn(
        self,
        input_items,
        print_steps=True,
        debug=False,
        show_images=False,
        status_callback: Callable[[dict], None] = None,
    ):
        """
        Processes one full turn of conversation until a final assistant response is reached.
        If a status_callback is provided, it will be called with status update messages.
        """
        self.print_steps = print_steps
        self.debug = debug
        self.show_images = show_images
        new_items = []

        # Keep looping until a final response (with role "assistant") is obtained.
        while new_items[-1].get("role") != "assistant" if new_items else True:
            self.debug_print([sanitize_message(msg) for msg in input_items + new_items])
            response = create_response(
                model=self.model,
                input=input_items + new_items,
                tools=self.tools,
                truncation="auto",
            )
            self.debug_print(response)

            if "output" not in response and self.debug:
                print(response)
                raise ValueError("No output from model")
            else:
                new_items += response["output"]
                for item in response["output"]:
                    new_items += self.handle_item(item, status_callback)
        return new_items