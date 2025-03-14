# Developer Guide

This document provides information for developers who want to modify or extend Octotools.

## Development Environment Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/octotools/octotools.git
   cd octotools
   ```

2. **Set up a virtual environment**:
   ```bash
   python -m venv env
   source env/bin/activate  # On Windows, use: env\Scripts\activate
   ```

3. **Install in development mode**:
   ```bash
   pip install -e .
   ```

4. **Install additional development dependencies**:
   ```bash
   pip install pytest black isort mypy
   ```

## Project Structure

The project is organized into several key components:

```
.
├── octotools/              # Main package
│   ├── __init__.py         # Package initialization
│   ├── api/                # API implementation
│   ├── cli/                # Command-line interface
│   ├── core/               # Core functionality
│   ├── utils/              # Utility functions
│   └── visualization/      # Visualization tools
├── tasks/                  # Task definitions
├── assets/                 # Static assets
├── docs/                   # Documentation
├── tests/                  # Test suite
├── setup.py                # Package configuration
├── requirements.txt        # Python dependencies
└── README.md               # Project overview
```

## Adding New Features

To add a new feature to Octotools:

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Implement your feature**:
   - Place your code in the appropriate module
   - Follow the existing code style
   - Add tests for your feature
   - Update documentation

3. **Submit a Pull Request**:
   - Push your branch to your fork
   - Create a pull request with a clear description of the changes

## Coding Standards

Octotools follows these coding standards:

1. **PEP 8**: Follow PEP 8 style guidelines
2. **Type Hints**: Use type hints for function parameters and return values
3. **Docstrings**: Use Google-style docstrings
4. **Testing**: Write tests for new functionality
5. **Code Formatting**: Use Black and isort for code formatting

Example of a well-documented function:

```python
def analyze_notebook(notebook_path: str, metrics: List[str] = None) -> Dict[str, Any]:
    """Analyze a Jupyter notebook and return metrics.
    
    Args:
        notebook_path: Path to the notebook file
        metrics: List of metrics to calculate. If None, calculate all metrics.
        
    Returns:
        Dictionary of metrics and their values
        
    Raises:
        FileNotFoundError: If the notebook file doesn't exist
        ValueError: If an invalid metric is specified
    """
    # Implementation
    pass
```

## Testing

To run the tests:

```bash
pytest
```

For more information about testing, see the [Testing Guide](testing.md).

## Documentation

When adding or modifying features, update the documentation:

1. **API Documentation**: Update docstrings in the code
2. **Usage Examples**: Add examples to show how to use the feature
3. **README**: Update the README if necessary

## Release Process

1. **Update Version**: Update the version in `setup.py`
2. **Create Changelog**: Update the changelog
3. **Create Tag**: Create a git tag for the version
4. **Build Distribution**: Build the distribution package
   ```bash
   python setup.py sdist bdist_wheel
   ```
5. **Upload to PyPI**: Upload the package to PyPI
   ```bash
   twine upload dist/*
   ```

## Getting Help

If you need help with the development process:

1. Check the [Troubleshooting](troubleshooting.md) guide
2. Open an issue on GitHub
3. Reach out to the maintainers 