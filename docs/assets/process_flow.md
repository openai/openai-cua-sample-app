# Process Flow Diagrams

This document contains flow diagrams illustrating the key processes in Octotools.

## Notebook Analysis Flow

The following diagram shows the process flow for analyzing a notebook.

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant API
    participant NotebookAnalyzer
    participant CellAnalyzer
    participant Utils

    User->>CLI: Run analyze command
    CLI->>API: Call analyze_notebook()
    API->>NotebookAnalyzer: analyze(notebook_path)
    NotebookAnalyzer->>Utils: load_config()
    Utils-->>NotebookAnalyzer: Return config
    NotebookAnalyzer->>NotebookAnalyzer: _load_notebook()
    loop For each cell
        NotebookAnalyzer->>CellAnalyzer: analyze_cell(cell)
        CellAnalyzer-->>NotebookAnalyzer: Return cell metrics
    end
    NotebookAnalyzer->>NotebookAnalyzer: _generate_metrics()
    NotebookAnalyzer-->>API: Return analysis results
    API->>Utils: format_output(results)
    Utils-->>API: Return formatted results
    API-->>CLI: Return formatted results
    CLI-->>User: Display results
```

## Visualization Flow

The following diagram shows the process flow for creating visualizations.

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant API
    participant NotebookAnalyzer
    participant NotebookVisualizer

    User->>CLI: Run visualize command
    CLI->>API: Call visualize_notebook()
    API->>NotebookAnalyzer: analyze(notebook_path)
    NotebookAnalyzer-->>API: Return analysis results
    API->>NotebookVisualizer: create_visualization(results, output_path)
    NotebookVisualizer->>NotebookVisualizer: _generate_graph()
    NotebookVisualizer->>NotebookVisualizer: _save_visualization()
    NotebookVisualizer-->>API: Return success
    API-->>CLI: Return success
    CLI-->>User: Display success message
```

## Batch Analysis Flow

The following diagram shows the process flow for batch analysis of multiple notebooks.

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant API
    participant NotebookAnalyzer

    User->>CLI: Run batch command
    CLI->>API: Call batch_analyze(notebook_paths)
    
    loop For each notebook
        API->>NotebookAnalyzer: analyze(notebook_path)
        NotebookAnalyzer-->>API: Return analysis results
        API->>API: Aggregate results
    end
    
    API-->>CLI: Return aggregated results
    CLI-->>User: Display aggregated results
```

## Overall System Architecture

The following diagram shows the overall system architecture.

```mermaid
graph TD
    User[User] -->|Uses| CLI[Command Line Interface]
    User -->|Uses| PythonAPI[Python API]
    CLI -->|Calls| Core[Core Library]
    PythonAPI -->|Calls| Core
    Core -->|Contains| Analyzer[Notebook Analyzer]
    Core -->|Contains| Visualizer[Notebook Visualizer]
    Core -->|Contains| Utils[Utilities]
    Analyzer -->|Analyzes| Notebooks[Jupyter Notebooks]
    Visualizer -->|Creates| Reports[Reports & Visualizations]
    Utils -->|Supports| Analyzer
    Utils -->|Supports| Visualizer
``` 