from computers import Computer
from utils import (
    create_response,
    show_image,
    pp,
    sanitize_message,
    check_blocklisted_url,
)
import json
from typing import Callable, List, Dict, Any, Optional


class Agent:
    """
    A sample agent class that can be used to interact with a computer.
    Enhanced with Octotools for complex reasoning.

    (See simple_cua_loop.py for a simple example without an agent.)
    """

    def __init__(
        self,
        model="computer-use-preview-2025-02-04",
        computer: Computer = None,
        tools: list[dict] = [],
        acknowledge_safety_check_callback: Callable = lambda: False,
        use_octotools: bool = False,
        octotools_engine: str = "gpt-4o",
        octotools_tools: Optional[List[str]] = None,
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
            
        # Octotools integration
        self.use_octotools = use_octotools
        if use_octotools:
            try:
                from octotools_wrapper import OctotoolsWrapper
                self.octotools = OctotoolsWrapper(
                    llm_engine=octotools_engine,
                    enabled_tools=octotools_tools
                )
                print("Octotools initialized successfully!")
            except ImportError as e:
                print(f"Warning: Could not initialize Octotools: {str(e)}")
                self.use_octotools = False
                self.octotools = None
        else:
            self.octotools = None

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
        """Enhanced run_full_turn with Octotools integration for complex reasoning."""
        self.print_steps = print_steps
        self.debug = debug
        self.show_images = show_images
        
        # Check if we should use Octotools for complex reasoning
        if self.use_octotools and self.octotools and self._needs_complex_reasoning(input_items):
            return self._handle_with_octotools(input_items)
            
        # Original CUA logic
        new_items = []

        # keep looping until we get a final response
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
                    new_items += self.handle_item(item)

        return new_items
        
    def _needs_complex_reasoning(self, input_items: List[Dict[str, Any]]) -> bool:
        """
        Determine if the query needs complex reasoning that would benefit from Octotools.
        This is a basic heuristic and can be enhanced based on specific requirements.
        
        Args:
            input_items: The list of input items
            
        Returns:
            bool: True if complex reasoning is needed, False otherwise
        """
        # Extract the latest user message
        latest_user_message = None
        for item in reversed(input_items):
            if item.get("role") == "user":
                latest_user_message = item.get("content", "")
                break
        
        if not latest_user_message:
            return False
        
        # Simple heuristic: check for keywords that might suggest complex reasoning
        complex_keywords = [
            "analyze", "compare", "calculate", "extract data", "search for", 
            "find information", "summarize", "visual analysis", 
            "collect data", "research", "solve"
        ]
        
        return any(keyword in latest_user_message.lower() for keyword in complex_keywords)
    
    def _handle_with_octotools(self, input_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Handle a query using Octotools for complex reasoning.
        
        Args:
            input_items: The list of input items
            
        Returns:
            List[Dict[str, Any]]: The result items
        """
        # Extract the latest user message and any screenshots
        latest_user_message = None
        latest_screenshot = None
        
        for item in reversed(input_items):
            if item.get("role") == "user" and not latest_user_message:
                latest_user_message = item.get("content", "")
            
            # Look for the most recent screenshot
            if not latest_screenshot and item.get("type") == "computer_call_output":
                output = item.get("output", {})
                if output.get("type") == "input_image":
                    image_url = output.get("image_url", "")
                    if image_url.startswith("data:image/png;base64,"):
                        latest_screenshot = image_url
        
        if not latest_user_message:
            return []
        
        # Get the current URL for context if in browser environment
        current_url = None
        if self.computer and self.computer.environment == "browser":
            try:
                current_url = self.computer.get_current_url()
            except:
                pass
        
        # Build context
        context = f"Current URL: {current_url}" if current_url else ""
        
        # Solve using Octotools
        if self.print_steps:
            print("Using Octotools for complex reasoning...")
            
        result = self.octotools.solve(
            query=latest_user_message,
            image_data=latest_screenshot.split("base64,")[1] if latest_screenshot else None,
            context=context
        )
        
        # Format the result for CUA
        answer = result.get("answer", "I couldn't find a solution using the available tools.")
        steps = result.get("steps", [])
        
        if self.print_steps:
            print(f"Octotools result: {answer[:100]}...")
        
        # Build a detailed response that includes steps taken
        detailed_response = answer + "\n\n"
        if steps:
            detailed_response += "I took the following steps to solve this:\n"
            for i, step in enumerate(steps, 1):
                tool_used = step.get("tool_used", "Unknown tool")
                reasoning = step.get("reasoning", "No reasoning provided")
                detailed_response += f"\n{i}. Used {tool_used}: {reasoning}"
        
        # Return as a message from the assistant
        return [{"role": "assistant", "content": detailed_response}]
