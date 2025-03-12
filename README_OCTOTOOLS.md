# Octotools Integration for CUA-SAMPLE-APP

This integration enhances the CUA-SAMPLE-APP framework with Octotools capabilities for improved reasoning and problem-solving.

## Components

The integration consists of the following components:

1. **SimpleOctotoolsWrapper** (`simple_octotools_wrapper.py`) - A lightweight wrapper that provides Octotools-like functionality using direct OpenAI API calls.

2. **OctotoolsIntegration** (`cua_octotools_integration_simple.py`) - A bridge component for connecting CUA-SAMPLE-APP with Octotools.

3. **OctotoolsAgent** (`octotools_agent.py`) - An enhanced agent that extends the base CUA Agent with Octotools reasoning capabilities.

4. **Test Scripts** - Multiple test scripts to verify different aspects of the integration.

## Setup

### Prerequisites

- Python 3.10 or higher
- CUA-SAMPLE-APP installed and working
- An OpenAI API key with access to GPT-4o or similar model

### Installation

1. Clone the Octotools repository (optional for minimal integration):
   ```bash
   git clone https://github.com/OctoTools/OctoTools.git octotools
   ```

2. Set up environment variables:
   ```bash
   echo "OPENAI_API_KEY=your-api-key" > .env
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Simple Integration

For a basic integration that doesn't require the full Octotools repository:

```bash
python cua_octotools_integration_simple.py --query "Explain the concept of recursion" --debug
```

### Advanced Integration

For a full integration that extends the CUA Agent:

```bash
python octotools_agent.py
```

This will start an interactive session using the OctotoolsAgent with browser automation.

### Standalone Testing

To test the SimpleOctotoolsWrapper independently:

```bash
python test_simple_octotools.py
```

## Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  CUA-SAMPLE-APP                         │
│                                                         │
│  ┌───────────────┐           ┌───────────────────────┐  │
│  │ Regular Agent │           │ OctotoolsAgent        │  │
│  └───────┬───────┘           └───────────┬───────────┘  │
│          │                               │              │
│          │                   ┌───────────┴───────────┐  │
│          │                   │ SimpleOctotoolsWrapper│  │
│          │                   └───────────────────────┘  │
│          │                               │              │
│   ┌──────┴───────────────────────────────┴─────────┐    │
│   │                  Computer                      │    │
│   └──────────────────────────────────────────────┐ │    │
└────────────────────────────────────────────────────────┘
```

## Troubleshooting

Common issues and solutions:

### API Key Problems

If you see errors related to the API key, ensure that:
- The `.env` file exists and contains `OPENAI_API_KEY=your-api-key`
- The API key is valid and has access to the required models

### Import Errors

If you encounter import errors:
- Ensure you're running the scripts from the project root directory
- Check that all dependencies are properly installed
- Make sure the CUA-SAMPLE-APP is correctly installed

### Integration Issues

If the integration doesn't work as expected:
- Try the simple integration first to isolate issues
- Enable debug mode to see more detailed information
- Check the test scripts to verify component functionality

## Future Improvements

This integration could be enhanced in the following ways:

1. Add more sophisticated detection for when to use Octotools vs. standard CUA behavior
2. Implement a more accurate simulation of all Octotools tools
3. Better error handling and fallback mechanisms
4. Add support for more advanced Octotools features

## License

This integration is subject to the same license as the CUA-SAMPLE-APP.

## Acknowledgements

This integration builds upon:
- [CUA-SAMPLE-APP](https://github.com/openai/openai-cua-sample-app) by OpenAI
- [Octotools](https://github.com/OctoTools/OctoTools) framework 