# Troubleshooting Guide

This document provides solutions to common issues you might encounter when working with Octotools.

## Installation Issues

### Package Installation Failures

**Problem**: Errors when installing Octotools or its dependencies.

**Solution**: 
1. Make sure you're using a compatible Python version (3.7+)
2. Try installing in development mode:
   ```bash
   pip install -e .
   ```
3. If specific dependencies are failing, try installing them manually:
   ```bash
   pip install numpy pandas matplotlib jupyter
   ```

### Import Errors

**Problem**: Import errors when trying to use Octotools.

**Solution**:
1. Make sure Octotools is installed in your current environment
2. Check your Python path:
   ```python
   import sys
   print(sys.path)
   ```
3. If using virtual environments, make sure you've activated the correct one

## Usage Issues

### Notebook Loading Failures

**Problem**: Errors when loading a Jupyter notebook.

**Solution**:
1. Check if the notebook file exists and is accessible
2. Verify the notebook file is valid JSON:
   ```bash
   # Check if the notebook is valid JSON
   python -c "import json; json.load(open('path/to/notebook.ipynb'))"
   ```
3. Try opening and resaving the notebook in Jupyter

### Analysis Errors

**Problem**: Errors during notebook analysis.

**Solution**:
1. Check for malformed cells in the notebook
2. Try running with debug logging enabled:
   ```bash
   octotools analyze --debug path/to/notebook.ipynb
   ```
3. If analyzing specific cells is failing, try excluding problematic cells:
   ```bash
   octotools analyze --exclude-cell 5 path/to/notebook.ipynb
   ```

### Visualization Errors

**Problem**: Errors when generating visualizations.

**Solution**:
1. Make sure matplotlib is installed correctly
2. Check if the output directory exists and is writable
3. Try specifying a different output format:
   ```bash
   octotools visualize --format png path/to/notebook.ipynb
   ```

## Performance Issues

### Slow Analysis

**Problem**: Notebook analysis is taking too long.

**Solution**:
1. For large notebooks, use the `--sample` option to analyze only a subset of cells:
   ```bash
   octotools analyze --sample 10 path/to/notebook.ipynb
   ```
2. Disable complex metrics that take longer to compute:
   ```bash
   octotools analyze --disable-metrics complexity,patterns path/to/notebook.ipynb
   ```
3. Use the batch processor with multiple processes for analyzing many notebooks:
   ```bash
   octotools batch --processes 4 path/to/notebooks/
   ```

### Memory Issues

**Problem**: Out of memory errors when analyzing large notebooks.

**Solution**:
1. Process cells individually instead of loading the whole notebook:
   ```bash
   octotools analyze --cell-by-cell path/to/notebook.ipynb
   ```
2. Increase the memory limit in your Python environment (if applicable)
3. Use the `--lite` mode for a lighter-weight analysis:
   ```bash
   octotools analyze --lite path/to/notebook.ipynb
   ```

## Configuration Issues

### Config File Not Found

**Problem**: Octotools can't find the configuration file.

**Solution**:
1. Create a default configuration file:
   ```bash
   octotools init-config
   ```
2. Specify the config file path explicitly:
   ```bash
   octotools --config /path/to/config.yaml analyze notebook.ipynb
   ```
3. Check the default config locations:
   - `~/.octotools/config.yaml`
   - `./octotools_config.yaml`

### Configuration Syntax Errors

**Problem**: Errors related to the configuration file syntax.

**Solution**:
1. Validate your configuration file:
   ```bash
   octotools validate-config /path/to/config.yaml
   ```
2. Reset to the default configuration:
   ```bash
   octotools reset-config
   ```
3. Check the configuration documentation for correct syntax

## CLI Issues

### Command Not Found

**Problem**: The `octotools` command is not found.

**Solution**:
1. Make sure the package is installed:
   ```bash
   pip install -e .
   ```
2. Check if the installation path is in your PATH environment variable
3. Try running the module directly:
   ```bash
   python -m octotools.cli
   ```

### Incorrect Command Usage

**Problem**: Command line arguments are not being recognized.

**Solution**:
1. Check the help documentation for the correct usage:
   ```bash
   octotools --help
   octotools analyze --help
   ```
2. Make sure you're using the correct syntax for your shell
3. If using special characters in arguments, use quotes:
   ```bash
   octotools analyze --output-path "/path/with spaces/output.json"
   ```

## Output Issues

### JSON Output Formatting

**Problem**: JSON output is not formatted correctly.

**Solution**:
1. Use an explicit formatting option:
   ```bash
   octotools analyze --format json-pretty path/to/notebook.ipynb
   ```
2. Use a specific output file:
   ```bash
   octotools analyze --output results.json path/to/notebook.ipynb
   ```
3. Pipe through a JSON formatter:
   ```bash
   octotools analyze --format json | python -m json.tool
   ```

### Visualization Quality

**Problem**: Generated visualizations have poor quality or readability.

**Solution**:
1. Adjust the figure size:
   ```bash
   octotools visualize --figure-size 12 8 path/to/notebook.ipynb
   ```
2. Change the DPI setting:
   ```bash
   octotools visualize --dpi 300 path/to/notebook.ipynb
   ```
3. Use a different theme or color scheme:
   ```bash
   octotools visualize --theme dark path/to/notebook.ipynb
   ```

## Advanced Troubleshooting

### Debug Mode

For detailed debugging information, run Octotools in debug mode:

```bash
octotools --debug analyze path/to/notebook.ipynb
```

### Logging

You can configure the logging level for more detailed output:

```bash
octotools --log-level DEBUG analyze path/to/notebook.ipynb
```

### Generate a Diagnostic Report

Generate a diagnostic report for support purposes:

```bash
octotools diagnostics > diagnostic_report.txt
```

### Check for Updates

Make sure you're using the latest version:

```bash
pip install --upgrade octotools
``` 