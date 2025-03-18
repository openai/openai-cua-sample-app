# Examples

The repository includes several example applications that demonstrate different aspects of the Computer Using Agent (CUA) functionality. This document provides an overview of these examples.

## Weather Example

The `weather_example.py` script demonstrates a simple, single-turn interaction with the CUA to check the weather.

```python
from agent import Agent
from computers import ScrapybaraBrowser

with ScrapybaraBrowser() as computer:
    agent = Agent(computer=computer)
    input_items = [{"role": "user", "content": "what is the weather in sf"}]
    response_items = agent.run_full_turn(input_items, debug=True, show_images=True)
    print(response_items[-1]["content"][0]["text"])
```

### Key aspects:
- Uses the ScrapybaraBrowser computer environment
- Sends a single query about the weather in San Francisco
- Uses the debug mode to show detailed information during execution
- Shows images (screenshots) during execution
- Prints only the final text response

## Function Calling Example

The `function_calling_example.py` script demonstrates how to integrate function calling with the CUA.

```python
from agent import Agent
from computers import ScrapybaraBrowser

tools = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "Determine weather in my location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and state e.g. San Francisco, CA",
                },
                "unit": {"type": "string", "enum": ["c", "f"]},
            },
            "additionalProperties": False,
            "required": ["location", "unit"],
        },
    }
]


def main():
    with ScrapybaraBrowser() as computer:
        agent = Agent(tools=tools, computer=computer)
        items = []
        while True:
            user_input = input("> ")
            items.append({"role": "user", "content": user_input})
            output_items = agent.run_full_turn(items)
            items += output_items


if __name__ == "__main__":
    main()
```

### Key aspects:
- Defines a `get_weather` function tool with parameters for location and temperature unit
- Uses the ScrapybaraBrowser computer environment
- Creates an interactive session that continually takes user input
- Adds the function tool to the Agent's available tools

This example shows how to:
1. Define a function schema using the OpenAI function calling format
2. Pass the function to the Agent via the `tools` parameter
3. Handle function calls in the Agent's conversation loop

## Playwright with Custom Functions

The `playwright_with_custom_functions.py` script demonstrates how to extend the CUA with custom browser navigation functions.

```python
from agent.agent import Agent
from computers import LocalPlaywrightComputer

tools = [
    {
        "type": "function",
        "name": "back",
        "description": "Go back to the previous page.",
        "parameters": {},
    },
    {
        "type": "function",
        "name": "goto",
        "description": "Go to a specific URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Fully qualified URL to navigate to.",
                },
            },
            "additionalProperties": False,
            "required": ["url"],
        },
    },
]


def main():
    with LocalPlaywrightComputer() as computer:
        agent = Agent(computer=computer, tools=tools)
        items = [
            {
                "role": "developer",
                "content": "Use the additional back() and goto() functions to naviate the browser. If you see nothing, trying going to Google.",
            }
        ]
        while True:
            user_input = input("> ")
            items.append({"role": "user", "content": user_input})
            output_items = agent.run_full_turn(items, show_images=False)
            items += output_items


if __name__ == "__main__":
    main()
```

### Key aspects:
- Uses the LocalPlaywrightComputer environment (local browser)
- Defines two custom function tools: `back()` and `goto(url)`
- Provides an initial developer message suggesting how to use these functions
- Creates an interactive session that continually takes user input
- Runs without showing images (screenshots) for faster execution

This example demonstrates how:
1. Custom functions can be defined and passed to the Agent
2. These functions can be implemented in the Computer class
3. The Agent will route function calls to the appropriate methods in the Computer implementation

## Running the Examples

To run any of the examples, use the following command:

```bash
python -m examples.<example_name>
```

For instance, to run the weather example:

```bash
python -m examples.weather_example
```

Note that some examples may require specific API keys or environment setup, particularly those using ScrapybaraBrowser or other remote browsers. 