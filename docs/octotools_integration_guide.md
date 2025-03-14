# Integrating Octotools with CUA-SAMPLE-APP

This guide provides comprehensive instructions for integrating the Octotools framework with the CUA-SAMPLE-APP to enhance its reasoning and problem-solving capabilities.

## Table of Contents

1. [Introduction](#introduction)
2. [Benefits of Integration](#benefits-of-integration)
3. [Architecture Overview](#architecture-overview)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Integration Steps](#integration-steps)
7. [Creating an Octotools-Enhanced Agent](#creating-an-octotools-enhanced-agent)
8. [Custom Tool Development](#custom-tool-development)
9. [Browser Automation with Octotools](#browser-automation-with-octotools)
10. [Examples](#examples)
11. [Troubleshooting](#troubleshooting)
12. [Further Resources](#further-resources)

## Introduction

Octotools is an open-source agentic framework designed for complex reasoning tasks across diverse domains. It provides standardized tools that can be easily integrated with large language models (LLMs). By integrating Octotools with the CUA-SAMPLE-APP, we can enhance the application's ability to perform multi-step reasoning, leverage specialized tools, and handle complex user queries.

## Benefits of Integration

1. **Enhanced Reasoning Capabilities**: Octotools provides a sophisticated planning and execution framework that enables multi-step reasoning.
2. **Extensible Tool Ecosystem**: Access to a wide range of pre-built tools for tasks like web search, image processing, code generation, and more.
3. **Standardized Tool Interface**: Consistent interface for creating and using tools, making it easy to extend functionality.
4. **Browser Automation Enhancement**: Augment CUA's browser automation with additional tools for understanding and interacting with web content.
5. **Performance Improvements**: Octotools has shown substantial average accuracy gains over raw LLM responses on complex reasoning tasks.

## Architecture Overview

The integrated system will combine CUA-SAMPLE-APP's Computer-Utilizing Agent capabilities with Octotools' reasoning framework:

```
┌───────────────────────────────────────────────────────────────┐
│                     CUA-SAMPLE-APP + Octotools                │
│                                                               │
│  ┌─────────────────┐     ┌────────────────────────────────┐   │
│  │   User Input    │     │       Enhanced Agent           │   │
│  └────────┬────────┘     │  ┌─────────────┐  ┌─────────┐  │   │
│           │              │  │     CUA     │  │Octotools│  │   │
│           ▼              │  │   Agent     │──►  Solver │  │   │
│  ┌────────────────┐      │  └─────────────┘  └─────────┘  │   │
│  │  Agent Router  │─────►│           │            │       │   │
│  └────────────────┘      │           │            │       │   │
│           ▲              │           ▼            ▼       │   │
│           │              │    ┌─────────────────────┐     │   │
│  ┌────────────────┐      │    │  Computer Interface │     │   │
│  │    Response    │◄─────│    └─────────────────────┘     │   │
│  │   Generation   │      │              │                 │   │
│  └────────────────┘      └──────────────┼─────────────────┘   │
│                                         │                     │
│                           ┌─────────────▼────────────┐        │
│                           │    Browser/Computer      │        │
│                           └──────────────────────────┘        │
└───────────────────────────────────────────────────────────────┘
```

## Prerequisites

Before integrating Octotools with CUA-SAMPLE-APP, ensure you have:

1. Python 3.10 or higher
2. CUA-SAMPLE-APP installed and working
3. Git for version control
4. API keys for required services:
   - OpenAI API key
   - Google API key and CX (for search functionality)
   - Any other API keys required by specific tools

## Installation

### Step 1: Add Octotools as a Dependency

Add Octotools to your project's requirements.txt:

```bash
echo "octotools @ git+https://github.com/OctoTools/OctoTools.git" >> requirements.txt
```

### Step 2: Install Dependencies

Install the updated dependencies:

```bash
pip install -r requirements.txt
```

### Step 3: Set Up Environment Variables

Add the necessary environment variables for Octotools in your `.env` file:

```
# Existing CUA-SAMPLE-APP variables
# ...

# Octotools API Keys
OPENAI_API_KEY=<your-openai-api-key>
GOOGLE_API_KEY=<your-google-api-key>
GOOGLE_CX=<your-google-cx>
```

## Integration Steps

### Step 1: Create an Octotools Wrapper

Create a new file `octotools_wrapper.py` in the project root:

```python
from octotools.models.solver import Solver
from typing import List, Dict, Any, Optional
import os
import base64


class OctotoolsWrapper:
    """
    Wrapper for Octotools integration with CUA-SAMPLE-APP.
    """
    
    def __init__(
        self,
        llm_engine: str = "gpt-4o",
        enabled_tools: Optional[List[str]] = None,
        max_steps: int = 5,
    ):
        """
        Initialize the Octotools wrapper.
        
        Args:
            llm_engine: The LLM engine to use (default: "gpt-4o")
            enabled_tools: List of tools to enable (default: None, which enables default tools)
            max_steps: Maximum number of steps for solving a task (default: 5)
        """
        self.llm_engine = llm_engine
        self.max_steps = max_steps
        
        # Default tools useful for browser automation context
        if enabled_tools is None:
            self.enabled_tools = [
                "Python_Code_Generator_Tool",
                "Text_Detector_Tool",
                "Image_Captioner_Tool",
                "Object_Detector_Tool",
                "Google_Search_Tool",
                "URL_Text_Extractor_Tool",
                "Generalist_Solution_Generator_Tool"
            ]
        else:
            self.enabled_tools = enabled_tools
        
        # Initialize the solver
        self.solver = Solver(
            model_string=self.llm_engine,
            enabled_tools=self.enabled_tools,
            max_steps=self.max_steps,
        )
    
    def solve(
        self,
        query: str,
        image_data: Optional[str] = None,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Solve a task using Octotools.
        
        Args:
            query: The user query to solve
            image_data: Optional base64-encoded image data
            context: Optional additional context for the solver
            
        Returns:
            Dictionary containing the solver output
        """
        # Process the image if provided
        image_path = None
        if image_data:
            # Save the image temporarily
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp:
                # Remove the data:image/png;base64, prefix if present
                if 'base64,' in image_data:
                    image_data = image_data.split('base64,')[1]
                
                temp.write(base64.b64decode(image_data))
                image_path = temp.name
        
        # Build full context with query and additional context
        full_query = query
        if context:
            full_query = f"{query}\n\nContext: {context}"
        
        # Solve the task
        result = self.solver.solve(
            query=full_query,
            image_path=image_path,
            verbose=True
        )
        
        # Clean up temporary file if created
        if image_path and os.path.exists(image_path):
            os.remove(image_path)
        
        return result
```

### Step 2: Enhance the Agent Class

Modify `agent/agent.py` to integrate Octotools:

```python
# Import the OctotoolsWrapper
from octotools_wrapper import OctotoolsWrapper

class Agent:
    """
    A sample agent class that can be used to interact with a computer.
    Enhanced with Octotools for complex reasoning.
    """

    def __init__(
        self,
        model="computer-use-preview-2025-02-04",
        computer: Computer = None,
        tools: list[dict] = [],
        acknowledge_safety_check_callback: Callable = lambda: False,
        use_octotools: bool = False,
        octotools_engine: str = "gpt-4o",
        octotools_tools: List[str] = None,
    ):
        # Existing initialization
        self.model = model
        self.computer = computer
        self.tools = tools
        self.print_steps = True
        self.debug = False
        self.show_images = False
        self.acknowledge_safety_check_callback = acknowledge_safety_check_callback

        if computer:
            self.tools += [
                {
                    "type": "computer-preview",
                    "display_width": computer.dimensions[0],
                    "display_height": computer.dimensions[1],
                    "environment": computer.environment,
                },
            ]
        
        # Octotools integration
        self.use_octotools = use_octotools
        if use_octotools:
            self.octotools = OctotoolsWrapper(
                llm_engine=octotools_engine,
                enabled_tools=octotools_tools
            )
        else:
            self.octotools = None
    
    # ... existing methods ...
    
    def run_full_turn(
        self, input_items, print_steps=True, debug=False, show_images=False
    ):
        """Enhanced run_full_turn with Octotools integration for complex reasoning."""
        self.print_steps = print_steps
        self.debug = debug
        self.show_images = show_images
        
        # Check if we should use Octotools for complex reasoning
        complex_reasoning_trigger = self._needs_complex_reasoning(input_items)
        
        if self.use_octotools and complex_reasoning_trigger:
            return self._handle_with_octotools(input_items)
        else:
            # Original CUA logic
            new_items = []
            # ... existing code ...
            return new_items
    
    def _needs_complex_reasoning(self, input_items):
        """
        Determine if the query needs complex reasoning that would benefit from Octotools.
        This is a basic heuristic and can be enhanced based on specific requirements.
        """
        # Extract the latest user message
        latest_user_message = None
        for item in reversed(input_items):
            if item.get("role") == "user":
                latest_user_message = item.get("content", "")
                break
        
        if not latest_user_message:
            return False
        
        # Simple heuristic: check for keywords that might suggest complex reasoning
        complex_keywords = [
            "analyze", "compare", "calculate", "extract data", "search for", 
            "find information", "summarize", "visual analysis", 
            "collect data", "research", "solve"
        ]
        
        return any(keyword in latest_user_message.lower() for keyword in complex_keywords)
    
    def _handle_with_octotools(self, input_items):
        """
        Handle a query using Octotools for complex reasoning.
        """
        # Extract the latest user message and any screenshots
        latest_user_message = None
        latest_screenshot = None
        
        for item in reversed(input_items):
            if item.get("role") == "user" and not latest_user_message:
                latest_user_message = item.get("content", "")
            
            # Look for the most recent screenshot
            if not latest_screenshot and item.get("type") == "computer_call_output":
                output = item.get("output", {})
                if output.get("type") == "input_image":
                    image_url = output.get("image_url", "")
                    if image_url.startswith("data:image/png;base64,"):
                        latest_screenshot = image_url
        
        if not latest_user_message:
            return []
        
        # Get the current URL for context if in browser environment
        current_url = None
        if self.computer and self.computer.environment == "browser":
            try:
                current_url = self.computer.get_current_url()
            except:
                pass
        
        # Build context
        context = f"Current URL: {current_url}" if current_url else ""
        
        # Solve using Octotools
        result = self.octotools.solve(
            query=latest_user_message,
            image_data=latest_screenshot.split("base64,")[1] if latest_screenshot else None,
            context=context
        )
        
        # Format the result for CUA
        answer = result.get("answer", "I couldn't find a solution using the available tools.")
        steps = result.get("steps", [])
        
        # Build a detailed response that includes steps taken
        detailed_response = answer + "\n\n"
        if steps:
            detailed_response += "I took the following steps to solve this:\n"
            for i, step in enumerate(steps, 1):
                tool_used = step.get("tool_used", "Unknown tool")
                reasoning = step.get("reasoning", "No reasoning provided")
                detailed_response += f"\n{i}. Used {tool_used}: {reasoning}"
        
        # Return as a message from the assistant
        return [{"role": "assistant", "content": detailed_response}]
```

### Step 3: Update Main Application

Update `main.py` to allow enabling Octotools:

```python
from agent.agent import Agent
from computers import LocalPlaywrightComputer
import argparse


def main(use_octotools=False):
    with LocalPlaywrightComputer() as computer:
        agent = Agent(
            computer=computer,
            use_octotools=use_octotools,
            octotools_engine="gpt-4o",
        )
        items = []
        while True:
            user_input = input("> ")
            items.append({"role": "user", "content": user_input})
            output_items = agent.run_full_turn(items, debug=True, show_images=True)
            items += output_items


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run CUA with optional Octotools integration")
    parser.add_argument('--use-octotools', action='store_true', help='Enable Octotools integration')
    args = parser.parse_args()
    
    main(use_octotools=args.use_octotools)
```

## Creating an Octotools-Enhanced Agent

For more advanced use cases, you can create a dedicated Octotools-enhanced agent:

```python
# octotools_agent.py
from agent.agent import Agent
from computers import Computer
from octotools_wrapper import OctotoolsWrapper
from typing import List, Dict, Any, Callable, Optional


class OctotoolsAgent(Agent):
    """
    An agent that combines CUA capabilities with Octotools reasoning.
    """
    
    def __init__(
        self,
        model="computer-use-preview-2025-02-04",
        computer: Computer = None,
        tools: list[dict] = [],
        acknowledge_safety_check_callback: Callable = lambda: False,
        octotools_engine: str = "gpt-4o",
        octotools_tools: Optional[List[str]] = None,
        reasoning_threshold: float = 0.7,
    ):
        super().__init__(
            model=model,
            computer=computer,
            tools=tools,
            acknowledge_safety_check_callback=acknowledge_safety_check_callback
        )
        
        # Initialize Octotools
        self.octotools = OctotoolsWrapper(
            llm_engine=octotools_engine,
            enabled_tools=octotools_tools
        )
        
        # Reasoning threshold determines when to use Octotools vs standard CUA
        self.reasoning_threshold = reasoning_threshold
        
        # Add an Octotools tool to the CUA tools list
        self.tools.append({
            "type": "function",
            "function": {
                "name": "use_octotools_reasoning",
                "description": "Use Octotools framework for complex reasoning tasks",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The query to solve using Octotools"
                        }
                    },
                    "required": ["query"]
                }
            }
        })
    
    def use_octotools_reasoning(self, query: str) -> str:
        """
        Use Octotools to solve a complex reasoning task.
        This can be called by the CUA as a tool.
        """
        # Capture the current screenshot
        screenshot_base64 = None
        if self.computer:
            screenshot_base64 = self.computer.screenshot()
        
        # Get current URL for context
        current_url = None
        if self.computer and self.computer.environment == "browser":
            try:
                current_url = self.computer.get_current_url()
            except:
                pass
        
        # Build context
        context = f"Current URL: {current_url}" if current_url else ""
        
        # Solve using Octotools
        result = self.octotools.solve(
            query=query,
            image_data=screenshot_base64,
            context=context
        )
        
        # Return the answer
        answer = result.get("answer", "I couldn't find a solution using the available tools.")
        return answer
    
    def handle_item(self, item):
        """Override to handle the Octotools function call."""
        if item["type"] == "function_call" and item["name"] == "use_octotools_reasoning":
            args = json.loads(item["arguments"])
            result = self.use_octotools_reasoning(args["query"])
            return [{
                "type": "function_call_output",
                "call_id": item["call_id"],
                "output": result
            }]
        else:
            # Use the original handle_item for other cases
            return super().handle_item(item)
```

## Custom Tool Development

You can extend Octotools with custom tools tailored for the CUA application:

### Example: Creating a Webpage Analysis Tool

```python
# webpage_analyzer_tool.py
from octotools.tools.base import BaseTool
from bs4 import BeautifulSoup


class Webpage_Analyzer_Tool(BaseTool):
    """
    A tool that analyzes the structure and content of a webpage.
    """
    
    def __init__(self):
        super().__init__(
            tool_name="Webpage_Analyzer_Tool",
            tool_description="Analyzes the structure and content of a webpage",
            tool_version="1.0.0",
            input_types={
                "html": "str - HTML content of the webpage to analyze",
                "analysis_type": "str - Type of analysis to perform (structure, content, links, or forms)"
            },
            output_type="dict - Analysis results containing requested information",
            demo_commands=[
                {
                    "command": 'execution = tool.execute(html="<html><body><h1>Title</h1></body></html>", analysis_type="structure")',
                    "description": "Analyze the structure of an HTML document"
                }
            ],
            user_metadata={
                "limitations": [
                    "Cannot analyze JavaScript-rendered content",
                    "Does not execute JavaScript code",
                    "Limited to static HTML analysis"
                ],
                "best_practices": [
                    "Provide complete HTML for accurate analysis",
                    "Specify the analysis type to get focused results"
                ]
            }
        )
    
    def execute(self, html, analysis_type="structure"):
        """
        Execute the webpage analysis tool.
        
        Args:
            html (str): HTML content of the webpage to analyze
            analysis_type (str): Type of analysis to perform (structure, content, links, or forms)
            
        Returns:
            dict: Analysis results containing requested information
        """
        # Parse the HTML
        soup = BeautifulSoup(html, 'html.parser')
        
        # Perform the requested analysis
        if analysis_type == "structure":
            return self._analyze_structure(soup)
        elif analysis_type == "content":
            return self._analyze_content(soup)
        elif analysis_type == "links":
            return self._analyze_links(soup)
        elif analysis_type == "forms":
            return self._analyze_forms(soup)
        else:
            return {"error": f"Unknown analysis type: {analysis_type}"}
    
    def _analyze_structure(self, soup):
        """Analyze the structure of the HTML document."""
        headings = {}
        for i in range(1, 7):
            headings[f'h{i}'] = len(soup.find_all(f'h{i}'))
        
        return {
            "title": soup.title.string if soup.title else None,
            "headings": headings,
            "paragraphs": len(soup.find_all('p')),
            "divs": len(soup.find_all('div')),
            "lists": {
                "ul": len(soup.find_all('ul')),
                "ol": len(soup.find_all('ol')),
            },
            "tables": len(soup.find_all('table'))
        }
    
    def _analyze_content(self, soup):
        """Extract the main content of the HTML document."""
        return {
            "title": soup.title.string if soup.title else None,
            "meta_description": soup.find('meta', attrs={'name': 'description'}).get('content') if soup.find('meta', attrs={'name': 'description'}) else None,
            "main_text": soup.get_text(strip=True)[:1000] + "..." if len(soup.get_text(strip=True)) > 1000 else soup.get_text(strip=True),
            "word_count": len(soup.get_text(strip=True).split())
        }
    
    def _analyze_links(self, soup):
        """Extract and analyze links in the HTML document."""
        links = soup.find_all('a')
        internal_links = []
        external_links = []
        
        for link in links:
            href = link.get('href')
            if href:
                if href.startswith('http') or href.startswith('//'):
                    external_links.append(href)
                else:
                    internal_links.append(href)
        
        return {
            "total_links": len(links),
            "internal_links": internal_links[:20],  # Limit to avoid overwhelming output
            "internal_link_count": len(internal_links),
            "external_links": external_links[:20],  # Limit to avoid overwhelming output
            "external_link_count": len(external_links)
        }
    
    def _analyze_forms(self, soup):
        """Extract and analyze forms in the HTML document."""
        forms = soup.find_all('form')
        form_analysis = []
        
        for i, form in enumerate(forms):
            inputs = form.find_all('input')
            input_details = []
            
            for input_field in inputs:
                input_type = input_field.get('type', 'text')
                input_name = input_field.get('name', '')
                input_details.append({
                    "type": input_type,
                    "name": input_name,
                    "id": input_field.get('id', ''),
                    "required": input_field.has_attr('required')
                })
            
            form_analysis.append({
                "form_id": form.get('id', f'form_{i}'),
                "method": form.get('method', 'get').upper(),
                "action": form.get('action', ''),
                "input_fields": input_details,
                "submit_button": bool(form.find('button', attrs={'type': 'submit'}) or form.find('input', attrs={'type': 'submit'}))
            })
        
        return {
            "form_count": len(forms),
            "forms": form_analysis
        }
```

## Browser Automation with Octotools

One powerful use case is to enhance CUA's browser automation capabilities with Octotools. Here's an example of how to combine them:

```python
# enhanced_browser_agent.py
from octotools_agent import OctotoolsAgent
from computers import LocalPlaywrightComputer


def run_enhanced_browser_agent():
    """
    Run an enhanced browser agent that combines CUA with Octotools.
    """
    with LocalPlaywrightComputer() as computer:
        # Define browser-specific tools
        browser_octotools = [
            "Python_Code_Generator_Tool",
            "Text_Detector_Tool",
            "Image_Captioner_Tool",
            "Object_Detector_Tool",
            "Webpage_Analyzer_Tool",  # Custom tool created above
            "URL_Text_Extractor_Tool"
        ]
        
        # Create the agent
        agent = OctotoolsAgent(
            computer=computer,
            octotools_tools=browser_octotools
        )
        
        items = []
        print("Enhanced Browser Agent with Octotools")
        print("Type 'exit' to quit")
        
        while True:
            user_input = input("> ")
            if user_input.lower() == 'exit':
                break
                
            items.append({"role": "user", "content": user_input})
            output_items = agent.run_full_turn(items, debug=True, show_images=True)
            items += output_items


if __name__ == "__main__":
    run_enhanced_browser_agent()
```

## Examples

Here are some examples of how to use the integrated system:

### Example 1: Basic Integration

```python
# Run with basic Octotools integration
python main.py --use-octotools
```

### Example 2: Advanced Integration

```python
# Using the enhanced browser agent
python enhanced_browser_agent.py
```

### Example 3: Custom Integration Script

```python
# custom_integration.py
from agent.agent import Agent
from computers import LocalPlaywrightComputer
from octotools_wrapper import OctotoolsWrapper

# Initialize components
computer = LocalPlaywrightComputer()
computer.start()

# Initialize Octotools wrapper with specific tools
octotools = OctotoolsWrapper(
    llm_engine="gpt-4o",
    enabled_tools=[
        "Python_Code_Generator_Tool",
        "Text_Detector_Tool",
        "Google_Search_Tool"
    ]
)

# Initialize agent without Octotools integration
agent = Agent(computer=computer)

# Process loop with manual Octotools integration
items = []
try:
    while True:
        user_input = input("> ")
        
        # Determine if we should use Octotools
        if any(keyword in user_input.lower() for keyword in ["search", "find", "calculate", "analyze"]):
            # Get current screenshot
            screenshot = computer.screenshot()
            
            # Use Octotools to solve
            result = octotools.solve(
                query=user_input,
                image_data=screenshot
            )
            
            # Add the result as an assistant message
            items.append({"role": "user", "content": user_input})
            items.append({"role": "assistant", "content": result["answer"]})
            print(result["answer"])
        else:
            # Use standard CUA processing
            items.append({"role": "user", "content": user_input})
            output_items = agent.run_full_turn(items, debug=True, show_images=True)
            items += output_items
finally:
    computer.stop()
```

## Troubleshooting

### Common Issues

#### Octotools Import Errors

If you encounter import errors for Octotools:

```
Make sure Octotools is properly installed:
pip install git+https://github.com/OctoTools/OctoTools.git
```

#### API Key Issues

If tools that require API keys don't work:

```
Check that all required API keys are correctly set in your .env file
```

#### Integration Conflicts

If you encounter conflicts between CUA and Octotools:

```
Ensure that you're not trying to use both frameworks for the same task simultaneously.
The OctotoolsAgent class should handle the proper coordination between them.
```

## Further Resources

- [Octotools Documentation](https://github.com/OctoTools/OctoTools/tree/main/docs)
- [CUA-SAMPLE-APP Documentation](https://github.com/openai/openai-cua-sample-app/tree/main/docs)
- [Custom Tool Development Guide](https://github.com/OctoTools/OctoTools/tree/main/docs/custom_tools.md)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference) 