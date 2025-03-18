# Agent Implementation

## Overview

The `Agent` class, defined in `agent/agent.py`, serves as the primary orchestrator for the interaction between:
- The user
- The OpenAI model
- The computer environment

It manages the conversation flow, handles model responses, and routes actions to the appropriate computer implementation.

## Class Definition

```python
class Agent:
    """
    A sample agent class that can be used to interact with a computer.

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
        octotools_tools: List[str] = None,
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
            self.octotools = OctotoolsWrapper(
                llm_engine=octotools_engine,
                enabled_tools=octotools_tools
            )
        else:
            self.octotools = None
```

## Key Methods

### `run_full_turn()`

The `run_full_turn()` method is the main entry point for running a complete interaction turn. It:

1. Takes the current conversation context as input
2. Calls the model to generate a response
3. Processes any actions in the response
4. Continues calling the model until a final response is reached

With Octotools integration, it can also:
5. Detect queries that need complex reasoning
6. Leverage specialized tools for enhanced problem-solving

```python
def run_full_turn(
    self, input_items, print_steps=True, debug=False, show_images=False
):
    self.print_steps = print_steps
    self.debug = debug
    self.show_images = show_images
    
    # Check if we should use Octotools for complex reasoning
    if self.use_octotools and self._needs_complex_reasoning(input_items):
        return self._handle_with_octotools(input_items)
    
    # Standard CUA processing
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
```

### `_needs_complex_reasoning()`

When Octotools integration is enabled, this method determines if a query requires complex reasoning:

```python
def _needs_complex_reasoning(self, input_items):
    """
    Determine if the query needs complex reasoning that would benefit from Octotools.
    This is a basic heuristic and can be enhanced based on specific requirements.
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
```

### `_handle_with_octotools()`

This method processes queries using Octotools when complex reasoning is needed:

```python
def _handle_with_octotools(self, input_items):
    """
    Handle a query using Octotools for complex reasoning.
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
    result = self.octotools.solve(
        query=latest_user_message,
        image_data=latest_screenshot.split("base64,")[1] if latest_screenshot else None,
        context=context
    )
    
    # Return as a message from the assistant
    return [{"role": "assistant", "content": result.get("answer", "")}]
```

### `handle_item()`

The `handle_item()` method processes individual items from the model's response:

- For `message` items, it displays the message to the user
- For `function_call` items, it executes functions
- For `computer_call` items, it:
  - Executes the specified computer action
  - Takes a screenshot of the result
  - Handles safety checks
  - Prepares the output to send back to the model

```python
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
```

## Initialization Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `model` | The OpenAI model to use | `"computer-use-preview-2025-02-04"` |
| `computer` | The Computer implementation to use | `None` |
| `tools` | A list of additional tools to provide to the model | `[]` |
| `acknowledge_safety_check_callback` | A callback function for handling safety checks | `lambda: False` |
| `use_octotools` | Whether to use Octotools integration | `False` |
| `octotools_engine` | The LLM engine to use for Octotools | `"gpt-4o"` |
| `octotools_tools` | List of Octotools tools to enable | `None` |

## Agent Workflow Diagram

### Standard Workflow
```
┌─────────────────┐
│                 │
│   User Input    │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│  run_full_turn  │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│  OpenAI Model   │
│    Response     │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│   handle_item   │
│                 │
└────────┬────────┘
         │
         │    ┌─────────┐
         ├────┤ message │
         │    └─────────┘
         │
         │    ┌─────────────┐
         ├────┤function_call│
         │    └─────────────┘
         │
         │    ┌──────────────┐
         └────┤computer_call │
              └───────┬──────┘
                      │
                      ▼
            ┌─────────────────┐
            │                 │
            │    Computer     │
            │    Action       │
            │                 │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │                 │
            │   Screenshot    │
            │                 │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │                 │
            │  Safety Checks  │
            │                 │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │                 │
            │ Return Output   │
            │                 │
            └─────────────────┘
```

### Octotools-Enhanced Workflow
```
┌─────────────────┐
│                 │
│   User Input    │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│  run_full_turn  │
│                 │
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│                      │
│ _needs_complex_      │
│    reasoning?        │
│                      │
└──────────┬───────────┘
           │
           ▼
      ┌────/\────┐
      │   Yes    │
      └────┬─────┘            ┌────/\────┐
           │                  │    No    │
           │                  └─────┬────┘
           ▼                        │
┌─────────────────┐                 │
│                 │                 │
│ _handle_with_   │                 │
│   octotools     │                 │
│                 │                 │
└────────┬────────┘                 │
         │                          │
         ▼                          │
┌─────────────────┐                 │
│                 │                 │
│   Octotools     │◀────────────────┘
│    Solver       │   (Standard Workflow)
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│ Return Response │
│                 │
└─────────────────┘
```

## Using the Agent

The most common way to use the Agent is through the CLI, which handles the initialization and interaction loop:

```python
with ComputerClass() as computer:
    agent = Agent(
        computer=computer,
        acknowledge_safety_check_callback=acknowledge_safety_check_callback,
    )
    items = []

    while True:
        user_input = args.input or input("> ")
        items.append({"role": "user", "content": user_input})
        output_items = agent.run_full_turn(
            items,
            print_steps=True,
            show_images=args.show,
            debug=args.debug,
        )
        items += output_items
        args.input = None
```

## Function Calling

The Agent supports function calling through the `tools` parameter. If the model calls a function that exists on the Computer implementation, the Agent will route the call to the appropriate method.

This is useful for extending the capabilities of the Computer implementation with custom functions that can't be expressed through standard computer actions like click or type.

## Safety Considerations

The Agent includes several safety measures:

- URL blocklisting for browser-based environments
- Safety check acknowledgment for potentially risky actions
- Exception handling for failures

The `acknowledge_safety_check_callback` parameter allows you to customize the behavior when a safety check is triggered. 