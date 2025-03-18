# 🛠️ Octotools Integration for CUA Sample App

This integration enhances the CUA Sample App with [Octotools](https://github.com/OctoTools/OctoTools) capabilities, providing advanced reasoning, problem-solving, and specialized tool access for AI agents.

## 📋 Overview

The Octotools integration enables CUA Sample App to:
- Perform complex multi-step reasoning
- Access specialized tools for different tasks
- Enhance browser automation with content analysis
- Generate code and analyze data
- Search for and extract information from the web

## 🧩 Components

The integration consists of the following key components:

1. **OctotoolsWrapper** (`octotools_wrapper.py`) - Core wrapper for Octotools functionality.

2. **OctotoolsAgent** (`octotools_agent.py`) - Enhanced agent extending the base CUA Agent with Octotools capabilities.

3. **SimpleOctotoolsWrapper** (`simple_octotools_wrapper.py`) - Lightweight wrapper using direct API calls for environments without full Octotools.

4. **CompleteOctotoolsWrapper** (`complete_octotools_wrapper.py`) - Full-featured wrapper with all Octotools capabilities.

5. **Integration Scripts** - Various scripts to demonstrate different integration patterns.

## ⚙️ Setup

### Prerequisites

- Python 3.10 or higher
- CUA Sample App installed and working
- An OpenAI API key with access to GPT-4o or similar model

### Quick Installation

1. **Clone the repository with submodules**:
   ```bash
   git clone https://github.com/jmanhype/openai-cua-sample-app.git
   cd openai-cua-sample-app
   ```

2. **Set up environment**:
   ```bash
   python setup_octotools.py
   ```
   
3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

### Manual Setup

If you prefer manual setup:

1. **Create `.env` file**:
   ```bash
   echo "OPENAI_API_KEY=your-api-key-here" > .env
   echo "OCTOTOOLS_MODEL=gpt-4o" >> .env
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

## 🚀 Usage

### Basic Integration

Run the CUA Sample App with Octotools enabled:

```bash
python main.py --use-octotools --debug
```

### Advanced Usage

Use the dedicated OctotoolsAgent with specific tools:

```bash
python run_octotools_agent.py --tools "Python_Code_Generator_Tool,Text_Detector_Tool,URL_Text_Extractor_Tool,Nature_News_Fetcher_Tool"
```

### Available Tools

The integration supports multiple tools:

| Tool | Description | Usage Example |
|------|-------------|---------------|
| `Generalist_Solution_Generator_Tool` | General problem-solving | Complex reasoning tasks |
| `Python_Code_Generator_Tool` | Generates Python code | "Write a script to parse CSV files" |
| `Text_Detector_Tool` | Analyzes text for key information | Extract entities from documents |
| `URL_Text_Extractor_Tool` | Extracts text from webpages | "Summarize this webpage" |
| `Nature_News_Fetcher_Tool` | Fetches news from Nature | "What's new in quantum computing?" |

## 🧪 Testing

Run tests to verify the integration:

```bash
# Test basic integration
python test_octotools.py

# Test simple wrapper
python test_simple_octotools.py

# Test full integration
python test_full_octotools.py
```

## 🔍 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  CUA Sample App                         │
│                                                         │
│  ┌───────────────┐           ┌───────────────────────┐  │
│  │ Regular Agent │           │ OctotoolsAgent        │  │
│  └───────┬───────┘           └───────────┬───────────┘  │
│          │                               │              │
│          │                   ┌───────────┴───────────┐  │
│          │                   │  OctotoolsWrapper     │  │
│          │                   └───────────────────────┘  │
│          │                               │              │
│   ┌──────┴───────────────────────────────┴─────────┐    │
│   │                  Computer                      │    │
│   └──────────────────────────────────────────────┐ │    │
└────────────────────────────────────────────────────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │  Octotools      │
                     │  Framework      │
                     └─────────────────┘
```

## 📚 Documentation

For more detailed documentation:

- **Integration Guide**: See `docs/octotools_integration_guide.md` for a comprehensive guide.
- **API Reference**: Check `octotools_wrapper.py` and `octotools_agent.py` for inline documentation.
- **Examples**: The `examples/` directory contains example usage patterns.

## ❓ Troubleshooting

### API Key Problems

If you see errors related to the API key:
- Ensure that the `.env` file contains `OPENAI_API_KEY=your-api-key`
- Verify your API key has access to the required models

### Import Errors

If you encounter import errors:
- Ensure all dependencies are properly installed
- Run from the project root directory
- Check that the octotools directory is correctly placed

### Performance Issues

If reasoning tasks are slow:
- Use a more powerful model like GPT-4o
- Reduce the number of enabled tools
- Set a lower max_steps value to limit iteration

## 👥 Contributing

Contributions are welcome! To contribute to this integration:

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests
5. Submit a pull request

## 📄 License

This integration is subject to the same license as the CUA Sample App. 