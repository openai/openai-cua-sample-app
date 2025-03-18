# Project Overview

## Introduction

The Computer Using Agent (CUA) Sample App is a reference implementation demonstrating how to build an agent that can use a computer through browser and terminal interfaces. This project shows how to implement OpenAI's Computer Protocol to enable an AI assistant to interact with a user's computer in a safe and controlled manner.

## Architecture

The CUA Sample App follows a modular architecture that separates the agent logic from the computer implementation:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  User Interface │────▶│     Agent       │────▶│    OpenAI API   │
│   (CLI/App)     │     │                 │     │                 │
│                 │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 │                       │
                                 ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │                 │     │                 │
                        │   Computer      │◀────│  Model Output   │
                        │ Implementation  │     │ (computer_call) │
                        │                 │     │                 │
                        └─────────────────┘     └─────────────────┘
```

### Key Components

1. **Agent**: The agent class handles communication with the OpenAI API and processes computer calls.
2. **Computer Protocol**: Defines the interface for how the agent interacts with the computer.
3. **Computer Implementations**: Various implementations of the Computer Protocol for different environments:
   - Browser (using Playwright)
   - Terminal
   - Docker containers
   - Remote browser services
4. **CLI Application**: Command-line interface for user interaction with the agent.

## Core Workflow

1. **User Input**: The user provides input through the CLI or application interface.
2. **Agent Processing**: The agent sends the user input to the OpenAI API along with conversation history.
3. **API Response**: The API returns responses, which may include computer calls.
4. **Computer Interaction**: Computer calls are executed by the appropriate Computer implementation.
5. **Response Display**: Results are displayed to the user, and the conversation continues.

## Key Features

- **Modular Architecture**: Clear separation of concerns, allowing different computer environments to be used interchangeably.
- **Multiple Computer Environments**: Support for various computer environments, including local browsers, Docker containers, and remote browser services.
- **Safety Measures**: URL blocklisting and safety check acknowledgments to ensure safe operation.
- **Function Calling**: Support for custom functions to be defined and used in the conversation.
- **Extensible Design**: Easily extended with new Computer implementations or custom functions.

## Getting Started

To get started with the CUA Sample App:

1. Clone the repository
2. Install dependencies with `pip install -r requirements.txt`
3. Run the application with `python main.py`

For more detailed information, see the [CLI Usage Guide](cli_usage.md) and [Developer Guide](developer_guide.md). 