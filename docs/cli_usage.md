# CLI Usage Guide

The Command Line Interface (CLI) provides an easy way to interact with the Computer Using Agent (CUA) system. It allows you to select different computer environments, configure execution parameters, and start an interactive session with the agent.

## Basic Usage

The basic command to run the CLI is:

```bash
python cli.py
```

This will start an interactive session with the default settings (local Playwright browser environment).

For enhanced reasoning capabilities with Octotools integration:

```bash
python main.py --use-octotools
```

## Command Line Arguments

The CLI supports several command-line arguments to customize its behavior:

| Argument | Description | Default |
|----------|-------------|---------|
| `--computer` | The computer environment to use | `local-playwright` |
| `--input` | Initial input to the agent (optional) | None |
| `--debug` | Enable debug mode | False |
| `--show` | Show images (screenshots) during execution | False |
| `--start-url` | Starting URL for browser environments | `https://bing.com` |

### Octotools-Specific Arguments

When using `main.py` or `run_octotools_agent.py`, additional options are available:

| Argument | Description | Default |
|----------|-------------|---------|
| `--use-octotools` | Enable Octotools integration | False |
| `--tools` | Comma-separated list of Octotools tools to enable | `Generalist_Solution_Generator_Tool` |
| `--engine` | LLM engine to use with Octotools | `gpt-4o` |

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

Using Octotools integration:

```bash
python main.py --use-octotools --debug
```

Using specific Octotools tools:

```bash
python run_octotools_agent.py --tools "Python_Code_Generator_Tool,Text_Detector_Tool,URL_Text_Extractor_Tool,Nature_News_Fetcher_Tool"
```

Combining multiple arguments:

```bash
python main.py --computer local-playwright --show --debug --use-octotools --tools "Python_Code_Generator_Tool,URL_Text_Extractor_Tool"
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

## Available Octotools Tools

When using Octotools integration, various specialized tools are available:

| Tool | Description | Use Case |
|------|-------------|----------|
| `Generalist_Solution_Generator_Tool` | General problem-solving | Complex reasoning tasks, strategy development |
| `Python_Code_Generator_Tool` | Generates Python code | Scripting, data processing, automation |
| `Text_Detector_Tool` | Analyzes text for key information | Entity extraction, document analysis |
| `URL_Text_Extractor_Tool` | Extracts text from webpages | Web scraping, content summarization |
| `Nature_News_Fetcher_Tool` | Fetches news from Nature | Research updates, scientific information |

For more details on Octotools, see the [Octotools Integration Guide](octotools_integration_guide.md).

## Implementation Details

### Main CLI

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

### Octotools-Enhanced Main Function

The main function in `main.py` adds Octotools support:

```python
def main():
    parser = argparse.ArgumentParser(
        description="Run the CUA Sample App with optional Octotools integration."
    )
    # Standard arguments...
    parser.add_argument('--use-octotools', action='store_true', help='Enable Octotools integration')
    parser.add_argument('--tools', type=str, help='Comma-separated list of Octotools tools to enable')
    parser.add_argument('--engine', type=str, default='gpt-4o', help='LLM engine to use with Octotools')
    args = parser.parse_args()

    # Parse tools if provided
    octotools_tools = None
    if args.tools:
        octotools_tools = [tool.strip() for tool in args.tools.split(',')]

    with ComputerClass() as computer:
        agent = Agent(
            computer=computer,
            acknowledge_safety_check_callback=acknowledge_safety_check_callback,
            use_octotools=args.use_octotools,
            octotools_engine=args.engine,
            octotools_tools=octotools_tools
        )
        # Main interaction loop...
```

## Interaction Flow

### Standard Flow
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

### Octotools-Enhanced Flow
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
│  with Octotools │
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
│  Needs Complex  │─────Yes────┐
│   Reasoning?    │            │
│                 │            │
└───────┬─────────┘            │
        │                      │
        No                     │
        │                      │
        ▼                      ▼
┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │
│ Standard Agent  │    │   Octotools     │
│    Processing   │    │    Processing   │
│                 │    │                 │
└────────┬────────┘    └────────┬────────┘
         │                      │
         └──────────────────────┘
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

To add new Octotools tools:

1. Add the tool name to the available tools list in `octotools_wrapper.py`
2. Specify the tool when running with the `--tools` parameter 