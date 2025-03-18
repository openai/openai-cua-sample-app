#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Complete Octotools Wrapper.

This module provides full access to the entire Octotools ecosystem and integrates
it seamlessly with the CUA-SAMPLE-APP framework.
"""

import os
import sys
import json
import base64
import importlib
import subprocess
import tempfile
import logging
from typing import Dict, List, Any, Optional, Union, Type, Set
from pathlib import Path
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("complete_octotools_wrapper")

class CompleteOctotoolsWrapper:
    """
    A comprehensive wrapper for the entire Octotools ecosystem.
    
    This class dynamically imports and registers all available Octotools tools
    and provides a unified interface for using them with CUA-SAMPLE-APP.
    """
    
    def __init__(
        self, 
        llm_engine: str = "gpt-4o", 
        enabled_tools: Optional[List[str]] = None,
        max_steps: int = 3,
        install_if_missing: bool = False,
        debug: bool = False
    ) -> None:
        """
        Initialize the complete Octotools wrapper.
        
        Args:
            llm_engine: The language model engine to use (default: "gpt-4o")
            enabled_tools: List of specific tools to enable. If None, all available tools are enabled.
            max_steps: Maximum number of steps to take when solving (default: 3)
            install_if_missing: Whether to attempt installing Octotools if it's missing (default: False)
            debug: Whether to enable debug logging (default: False)
        """
        # Set debug mode
        if debug:
            logger.setLevel(logging.DEBUG)
        
        # Load environment variables
        load_dotenv()
        
        # Check API key
        if not os.environ.get("OPENAI_API_KEY"):
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        
        self.llm_engine = llm_engine
        self.max_steps = max_steps
        self.enabled_tools = enabled_tools
        
        # Try to import Octotools
        try:
            # First, try the direct import approach
            self._import_octotools()
            
            # If we get here, Octotools is installed
            logger.info("Octotools package found and imported successfully")
            
            # Initialize the Octotools components
            self._initialize_octotools()
            
        except ImportError as e:
            logger.error(f"Failed to import Octotools: {e}")
            
            if install_if_missing:
                logger.info("Attempting to install Octotools...")
                if self._install_octotools():
                    logger.info("Octotools installed successfully")
                    
                    # Try importing again
                    try:
                        self._import_octotools()
                        self._initialize_octotools()
                    except ImportError as e2:
                        raise ImportError(f"Failed to import Octotools after installation: {e2}")
                else:
                    raise RuntimeError("Failed to install Octotools and no fallback is permitted")
            else:
                raise ImportError(f"Octotools package is required but not installed: {e}")
    
    def _import_octotools(self) -> None:
        """Import the Octotools package and its components."""
        # Global imports to avoid issues if the package doesn't exist
        global BaseTool, ChatOpenAI
        
        # Import core components - Note the adjustment based on actual package structure
        from octotools.tools.base import BaseTool
        
        # Check for OpenAI engine in Octotools
        try:
            from octotools.engine.openai import ChatOpenAI
            logger.info("Successfully imported ChatOpenAI from Octotools")
        except ImportError as e:
            logger.error(f"Failed to import ChatOpenAI from Octotools: {e}")
            # We will NOT create a fallback - instead we'll propagate the error
            raise ImportError(f"Required Octotools component ChatOpenAI not found: {e}")
        
        # Store these for later use
        self.BaseTool = BaseTool
        self.ChatOpenAI = ChatOpenAI
    
    def _install_octotools(self) -> bool:
        """
        Install Octotools package if it's missing.
        
        Returns:
            bool: True if installation was successful, False otherwise
        """
        try:
            logger.info("Installing octotools from GitHub...")
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "git+https://github.com/OctoTools/OctoTools.git"]
            )
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install Octotools: {e}")
            return False
    
    def _discover_tools(self) -> Dict[str, Type]:
        """
        Dynamically discover all available Octotools tools.
        
        Returns:
            Dict[str, Type]: Dictionary mapping tool names to tool classes
        """
        all_tools = {}
        
        # Get the octotools package path
        import octotools
        tools_dir = os.path.join(os.path.dirname(octotools.__file__), "tools")
        
        # List all possible tool directories
        tool_dirs = []
        try:
            for item in os.listdir(tools_dir):
                item_path = os.path.join(tools_dir, item)
                if os.path.isdir(item_path) and not item.startswith("__"):
                    tool_dirs.append(item_path)
        except Exception as e:
            logger.warning(f"Failed to list tool directories: {e}")
        
        # Now try to dynamically discover tools by walking the tools directory
        for tool_dir in tool_dirs:
            # Skip directories that are not tools
            if os.path.basename(tool_dir) == "base.py":
                continue
                
            # Check if there's a tool.py file in the directory
            tool_file = os.path.join(tool_dir, "tool.py")
            if os.path.exists(tool_file):
                try:
                    # Get directory name as module name
                    dir_name = os.path.basename(tool_dir)
                    
                    # Import the module using importlib
                    module_path = f"octotools.tools.{dir_name}.tool"
                    try:
                        module = importlib.import_module(module_path)
                        
                        # Look for tool classes in the module
                        for attr_name in dir(module):
                            if attr_name.endswith("_Tool") and not attr_name.startswith("__"):
                                try:
                                    attr = getattr(module, attr_name)
                                    if isinstance(attr, type) and issubclass(attr, self.BaseTool) and attr != self.BaseTool:
                                        tool_name = attr_name
                                        all_tools[tool_name] = attr
                                        logger.debug(f"Discovered tool: {tool_name}")
                                except (TypeError, AttributeError) as e:
                                    logger.debug(f"Failed to load tool class {attr_name}: {e}")
                    except ImportError as e:
                        logger.debug(f"Failed to import module {module_path}: {e}")
                except Exception as e:
                    logger.debug(f"Error processing directory {tool_dir}: {e}")
        
        # Add some well-known tools by name if they weren't discovered
        known_tools = {
            "Python_Code_Generator_Tool": "octotools.tools.python_code_generator.tool",
            "Generalist_Solution_Generator_Tool": "octotools.tools.generalist_solution_generator.tool",
            "Image_Captioner_Tool": "octotools.tools.image_captioner.tool"
        }
        
        for tool_name, module_path in known_tools.items():
            if tool_name not in all_tools:
                try:
                    module = importlib.import_module(module_path)
                    tool_class = getattr(module, tool_name)
                    all_tools[tool_name] = tool_class
                    logger.debug(f"Added known tool: {tool_name}")
                except (ImportError, AttributeError) as e:
                    logger.debug(f"Failed to import known tool {tool_name}: {e}")
        
        if not all_tools:
            raise ImportError("Failed to discover any tools from Octotools")
            
        logger.info(f"Discovered {len(all_tools)} tools from Octotools")
        return all_tools
    
    def _initialize_octotools(self) -> None:
        """Initialize Octotools components and discover available tools."""
        try:
            # Discover all available tools
            self.available_tools = self._discover_tools()
            
            # Initialize tool instances based on enabled_tools or use all available
            self.tools = []
            
            if self.enabled_tools is None:
                # Use all available tools
                logger.info("Initializing all available Octotools tools")
                for tool_name, tool_class in self.available_tools.items():
                    try:
                        tool_instance = tool_class(model_string=self.llm_engine)
                        self.tools.append(tool_instance)
                        logger.debug(f"Initialized tool: {tool_name}")
                    except Exception as e:
                        logger.warning(f"Failed to initialize tool {tool_name}: {e}")
            else:
                # Use only the specified tools
                logger.info(f"Initializing specified Octotools tools: {', '.join(self.enabled_tools)}")
                found_tools = 0
                for tool_name in self.enabled_tools:
                    if tool_name in self.available_tools:
                        try:
                            tool_class = self.available_tools[tool_name]
                            tool_instance = tool_class(model_string=self.llm_engine)
                            self.tools.append(tool_instance)
                            found_tools += 1
                            logger.debug(f"Initialized tool: {tool_name}")
                        except Exception as e:
                            logger.warning(f"Failed to initialize tool {tool_name}: {e}")
                    else:
                        logger.warning(f"Tool '{tool_name}' not found in available tools")
                
                if found_tools == 0 and self.enabled_tools:
                    raise RuntimeError(f"None of the specified tools could be initialized: {', '.join(self.enabled_tools)}")
            
            if not self.tools:
                raise RuntimeError("Failed to initialize any Octotools tools")
                
            logger.info(f"Initialized CompleteOctotoolsWrapper with {len(self.tools)} tools")
            for tool in self.tools:
                logger.debug(f"  - {tool.__class__.__name__}")
                
        except Exception as e:
            logger.error(f"Failed to initialize Octotools: {e}")
            raise RuntimeError(f"Failed to initialize Octotools components: {e}")
    
    def get_available_tool_names(self) -> List[str]:
        """
        Get a list of all available tool names.
        
        Returns:
            List[str]: Names of all available tools
        """
        if hasattr(self, "available_tools"):
            return list(self.available_tools.keys())
        else:
            raise RuntimeError("Octotools has not been properly initialized")
    
    def solve(
        self, 
        query: str, 
        image_data: Optional[str] = None,
        context: Optional[str] = None,
        extra_args: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Solve a task using Octotools.
        
        Args:
            query: The user's query
            image_data: Optional base64-encoded image data (with or without the data:image prefix)
            context: Optional additional context for the solver
            extra_args: Optional additional arguments to pass to the solver
            
        Returns:
            A dictionary containing the result of the solving process
        """
        return self._solve_with_tools(query, image_data, context, extra_args)
    
    def _solve_with_tools(
        self, 
        query: str, 
        image_data: Optional[str] = None,
        context: Optional[str] = None,
        extra_args: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Solve a task using the actual Octotools tools.
        
        Args:
            query: The user's query
            image_data: Optional base64-encoded image data
            context: Optional additional context for the solver
            extra_args: Optional additional arguments to pass to the solver
            
        Returns:
            A dictionary containing the result of the solving process
        """
        try:
            # Build full query with context
            full_query = query
            if context:
                full_query = f"{query}\n\nContext: {context}"
            
            # Process image if provided
            image_path = None
            if image_data:
                # Save the image temporarily
                with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp:
                    # Remove the data:image/png;base64, prefix if present
                    if 'base64,' in image_data:
                        image_data = image_data.split('base64,')[1]
                    
                    temp.write(base64.b64decode(image_data))
                    image_path = temp.name
            
            # Select the most appropriate tool for the task
            # For now, we'll use a simple heuristic to select the tool
            selected_tool = self._select_tool(full_query, image_path is not None)
            
            if selected_tool is None:
                raise RuntimeError("No appropriate tool found for the query")
            
            logger.info(f"Using tool: {selected_tool.__class__.__name__}")
            
            # Execute the tool
            if image_path and hasattr(selected_tool, 'execute') and 'image' in selected_tool.execute.__code__.co_varnames:
                # Tool supports image input
                result = selected_tool.execute(prompt=full_query, image=image_path)
            else:
                # Tool doesn't support image input or it's not provided
                if hasattr(selected_tool, 'execute') and 'prompt' in selected_tool.execute.__code__.co_varnames:
                    result = selected_tool.execute(prompt=full_query)
                else:
                    result = selected_tool.execute(query=full_query)
            
            # Format the result
            formatted_result = {
                "answer": result if isinstance(result, str) else str(result),
                "steps": [{
                    "tool_used": selected_tool.__class__.__name__,
                    "sub_goal": f"Process the query: {query[:100]}{'...' if len(query) > 100 else ''}",
                    "result": result if isinstance(result, str) else str(result)
                }]
            }
            
            return formatted_result
            
        except Exception as e:
            logger.error(f"Error in CompleteOctotoolsWrapper._solve_with_tools: {e}", exc_info=True)
            raise RuntimeError(f"Error solving query with Octotools: {e}")
        finally:
            # Clean up temporary file if created
            if image_path and os.path.exists(image_path):
                os.remove(image_path)
    
    def _select_tool(self, query: str, has_image: bool) -> Optional[Any]:
        """
        Select the most appropriate tool for the query.
        
        Args:
            query: The user's query
            has_image: Whether the query includes an image
            
        Returns:
            Optional[Any]: The selected tool instance or None if no appropriate tool was found
        """
        # If no tools are available, return None
        if not self.tools:
            return None
        
        # If query is related to code generation, use the Python Code Generator Tool
        if any(keyword in query.lower() for keyword in [
            "code", "python", "script", "function", "algorithm", "program"
        ]):
            for tool in self.tools:
                if tool.__class__.__name__ == "Python_Code_Generator_Tool":
                    return tool
        
        # If query is related to image analysis and an image is provided, use an image tool
        if has_image:
            for tool in self.tools:
                if tool.__class__.__name__ in ["Image_Captioner_Tool", "Object_Detector_Tool", "Text_Detector_Tool"]:
                    return tool
        
        # Default to Generalist Solution Generator Tool
        for tool in self.tools:
            if tool.__class__.__name__ == "Generalist_Solution_Generator_Tool":
                return tool
        
        # If no specific tool found, return the first available tool
        return self.tools[0] if self.tools else None
    
    def encode_image_to_base64(self, image_path: str) -> str:
        """
        Encode an image file to base64.
        
        Args:
            image_path: Path to the image file
        
        Returns:
            Base64 encoded string of the image
        """
        try:
            with open(image_path, "rb") as image_file:
                return base64.b64encode(image_file.read()).decode("utf-8")
        except Exception as e:
            logger.error(f"Error encoding image: {e}")
            raise RuntimeError(f"Error encoding image: {e}")

# Simple unit test function
def test_wrapper():
    """Run a simple test of the CompleteOctotoolsWrapper."""
    wrapper = CompleteOctotoolsWrapper(
        llm_engine="gpt-4o",
        debug=True,
        install_if_missing=True
    )
    
    # List available tools
    available_tools = wrapper.get_available_tool_names()
    print(f"Available tools: {', '.join(available_tools)}")
    
    # Simple test query
    test_query = "What is 2+2? Provide a simple answer."
    print(f"\nSending test query: '{test_query}'")
    
    # Execute the query
    result = wrapper.solve(query=test_query)
    
    # Check the result
    if "answer" in result:
        print("\nResult:")
        print(result["answer"])
        
        if "steps" in result and result["steps"]:
            print("\nSteps taken:")
            for i, step in enumerate(result["steps"], 1):
                print(f"  {i}. {step.get('tool_used', 'Unknown')}: {step.get('sub_goal', 'No reasoning provided')}")
                
    return result

if __name__ == "__main__":
    test_wrapper() 