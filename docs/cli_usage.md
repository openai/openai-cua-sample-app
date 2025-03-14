# CLI Usage Guide

The Command Line Interface (CLI) provides an easy way to interact with the Computer Using Agent (CUA) system. It allows you to select different computer environments, configure execution parameters, and start an interactive session with the agent.

## Basic Usage

The basic command to run the CLI is:

```bash
python cli.py
```

This will start an interactive session with the default settings (local Playwright browser environment).

## Command Line Arguments

The CLI supports several command-line arguments to customize its behavior:

| Argument | Description | Default |
|----------|-------------|---------|
| `--computer` | The computer environment to use | `local-playwright` |
| `--input` | Initial input to the agent (optional) | None |
| `--debug` | Enable debug mode | False |
| `--show` | Show images (screenshots) during execution | False |
| `--start-url` | Starting URL for browser environments | `https://bing.com` |

### Example Usage

Using a different computer environment:

```bash
python cli.py --computer docker
```

Providing an initial input:

```bash
python cli.py --input "Search for information about climate change"
```

Enabling debug mode:

```bash
python cli.py --debug
```

Showing images during execution:

```bash
python cli.py --show
```

Specifying a start URL:

```bash
python cli.py --start-url "https://www.google.com"
```

Combining multiple arguments:

```bash
python cli.py --computer local-playwright --show --debug --start-url "https://www.wikipedia.org"
```

## Available Computer Environments

The CLI supports several computer environments, each with its own requirements and characteristics.

| Environment Option | Description | Type | Requirements |
|--------------------|-------------|------|-------------|
| `local-playwright` | Local browser window | Browser | Playwright SDK |
| `docker` | Docker container environment | Linux | Docker running |
| `browserbase` | Remote browser environment | Browser | Browserbase API key in `.env` |
| `scrapybara-browser` | Remote browser environment | Browser | Scrapybara API key in `.env` |
| `scrapybara-ubuntu` | Remote Ubuntu desktop | Linux | Scrapybara API key in `.env` |

## Implementation Details

The CLI is implemented in `cli.py`. Here's an overview of the key components:

### Safety Check Callback

```python
def acknowledge_safety_check_callback(message: str) -> bool:
    response = input(
        f"Safety Check Warning: {message}\nDo you want to acknowledge and proceed? (y/n): "
    ).lower()
    return response.lower().strip() == "y"
```

This function is called when the agent encounters a safety check. It displays the safety warning message and asks the user if they want to proceed.

### Main Function

```python
def main():
    parser = argparse.ArgumentParser(
        description="Select a computer environment from the available options."
    )
    parser.add_argument(
        "--computer",
        choices=[
            "local-playwright",
            "docker",
            "browserbase",
            "scrapybara-browser",
            "scrapybara-ubuntu",
        ],
        help="Choose the computer environment to use.",
        default="local-playwright",
    )
    # ...other arguments...
    args = parser.parse_args()

    computer_mapping = {
        "local-playwright": LocalPlaywrightComputer,
        "docker": DockerComputer,
        "browserbase": BrowserbaseBrowser,
        "scrapybara-browser": ScrapybaraBrowser,
        "scrapybara-ubuntu": ScrapybaraUbuntu,
    }

    ComputerClass = computer_mapping[args.computer]

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

The main function:
1. Parses command-line arguments
2. Maps the selected computer environment to the appropriate class
3. Creates an instance of the selected Computer class
4. Creates an Agent with the computer instance
5. Enters the main interaction loop, where it:
   - Gets user input (or uses the provided initial input)
   - Adds the input to the conversation context
   - Runs a full turn of the agent
   - Adds the agent's output to the conversation context
   - Resets the initial input (so it's only used once)

## Interaction Flow

```
┌─────────────────┐
│                 │
│  Parse Command  │
│  Line Arguments │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│ Create Computer │
│   Environment   │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│  Create Agent   │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│  Get User Input │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│Run Agent Full   │
│     Turn        │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│Update Convo     │
│Context          │
│                 │
└────────┬────────┘
         │
         └─────────────┐
                       │
                       ▼
                   ┌───────┐
                   │ Loop  │
                   └───────┘
```

## Error Handling

The CLI includes basic error handling:
- If the model returns an error, it's displayed to the user
- If a safety check fails, the program raises a ValueError with the safety message
- The context manager pattern (`with ComputerClass() as computer:`) ensures proper cleanup of computer environment resources, even in case of errors

## Extending the CLI

To add a new computer environment to the CLI:

1. Implement the Computer protocol in a new class
2. Add your class to the `computers/__init__.py` file
3. Add your environment option to the `--computer` argument choices
4. Add your class to the `computer_mapping` dictionary 