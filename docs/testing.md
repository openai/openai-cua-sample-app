# Testing Guide

This document provides guidance on testing Octotools to ensure it works correctly and reliably.

## Testing Framework

Octotools uses pytest as its testing framework. Tests are located in the `tests/` directory and follow the pytest conventions.

## Test Types

The Octotools test suite includes several types of tests:

1. **Unit Tests** - Testing individual components in isolation
2. **Integration Tests** - Testing how components work together
3. **Functional Tests** - Testing end-to-end functionality
4. **Regression Tests** - Ensuring new changes don't break existing functionality

## Running Tests

### Running All Tests

To run all tests:

```bash
pytest
```

### Running Specific Tests

To run tests from a specific file:

```bash
pytest tests/test_specific_module.py
```

To run a specific test:

```bash
pytest tests/test_specific_module.py::test_specific_function
```

### Test Coverage

To run tests with coverage:

```bash
pytest --cov=octotools
```

To generate a coverage report:

```bash
pytest --cov=octotools --cov-report=html
```

This will create an HTML report in the `htmlcov/` directory.

## Writing Tests

### Unit Tests

Unit tests should test individual functions or classes in isolation. Here's an example of a unit test:

```python
from typing import Any, Dict, List, TYPE_CHECKING
import pytest
from octotools.core import analyze_cell

if TYPE_CHECKING:
    from _pytest.capture import CaptureFixture
    from _pytest.fixtures import FixtureRequest
    from _pytest.logging import LogCaptureFixture
    from _pytest.monkeypatch import MonkeyPatch
    from pytest_mock.plugin import MockerFixture

def test_analyze_cell_empty() -> None:
    """Test that analyze_cell handles an empty cell correctly."""
    result = analyze_cell("")
    assert result["code_length"] == 0
    assert result["has_output"] is False

def test_analyze_cell_with_code() -> None:
    """Test that analyze_cell correctly analyzes a cell with code."""
    result = analyze_cell("print('Hello, world!')")
    assert result["code_length"] == 21
    assert result["has_output"] is False
```

### Integration Tests

Integration tests check that different components work together correctly:

```python
import pytest
from octotools.core import load_notebook, analyze_notebook

def test_notebook_analysis_pipeline() -> None:
    """Test the full notebook analysis pipeline."""
    notebook = load_notebook("tests/fixtures/example_notebook.ipynb")
    results = analyze_notebook(notebook)
    
    assert "cell_count" in results
    assert "code_cells" in results
    assert "markdown_cells" in results
```

### Fixtures

Use pytest fixtures to set up and tear down test environments:

```python
import pytest
import tempfile
import os
from typing import Generator

@pytest.fixture
def temp_notebook() -> Generator[str, None, None]:
    """Create a temporary notebook file for testing."""
    with tempfile.NamedTemporaryFile(suffix=".ipynb", delete=False) as f:
        f.write(b'''{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": 1,
   "metadata": {},
   "source": [
    "print(\\"Hello, world!\\")"
   ],
   "outputs": []
  }
 ],
 "metadata": {},
 "nbformat": 4,
 "nbformat_minor": 4
}''')
        temp_path = f.name
    
    yield temp_path
    
    # Cleanup
    os.unlink(temp_path)
```

### Mocking

Use mocking to isolate the code being tested:

```python
def test_with_mocking(mocker: "MockerFixture") -> None:
    """Test using mocks to isolate the code being tested."""
    # Mock a function
    mock_load = mocker.patch("octotools.core.load_notebook")
    mock_load.return_value = {"cells": []}
    
    # Test the function that uses load_notebook
    from octotools.core import count_cells
    result = count_cells("dummy.ipynb")
    
    # Verify the result and that the mock was called
    assert result == 0
    mock_load.assert_called_once_with("dummy.ipynb")
```

## Test Organization

Organize tests according to the module they test:

```
tests/
├── __init__.py
├── core/
│   ├── __init__.py
│   ├── test_notebook.py
│   └── test_cell.py
├── api/
│   ├── __init__.py
│   └── test_api.py
├── cli/
│   ├── __init__.py
│   └── test_cli.py
└── utils/
    ├── __init__.py
    └── test_utils.py
```

## Continuous Integration

Octotools uses GitHub Actions for continuous integration testing. The CI configuration is located in `.github/workflows/`.

## Test Guidelines

1. **Test Coverage**: Aim for high test coverage, especially for critical components
2. **Test Edge Cases**: Test boundary conditions and error handling
3. **Test Readability**: Write clear, readable tests with meaningful names
4. **Test Independence**: Tests should not depend on other tests
5. **Test Performance**: Tests should run quickly

## Test Documentation

Each test should have a clear docstring explaining what it tests and why.

## Debugging Tests

If a test fails, you can use the following techniques to debug it:

1. **Verbose Mode**: Run pytest in verbose mode:
   ```bash
   pytest -v
   ```

2. **Print Debugging**: Use `print` statements or the pytest `capfd` fixture:
   ```python
   def test_with_debug(capfd: "CaptureFixture") -> None:
       print("Debug information")
       # Test code
       captured = capfd.readouterr()
       print(captured.out)  # Shows all output
   ```

3. **PDB Debugger**: Use the PDB debugger:
   ```bash
   pytest --pdb
   ```

## Test Maintenance

Regularly review and update tests to ensure they remain relevant and effective. 