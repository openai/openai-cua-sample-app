#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Octotools wrapper for integration with CUA-SAMPLE-APP.

This module provides a wrapper class for integrating Octotools
with the CUA-SAMPLE-APP framework, enabling complex reasoning
capabilities alongside browser automation.
"""

from typing import List, Optional, Dict, Any
import os
import tempfile
import json
from PIL import Image
import traceback

# Add the octotools repository path to sys.path
import sys
octotools_repo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'octotools')
if octotools_repo_path not in sys.path:
    sys.path.append(octotools_repo_path)

# Import Octotools modules
from octotools.octotools.models.executor import Executor
from octotools.octotools.models.planner import Planner
from octotools.octotools.models.memory import Memory

class OctotoolsWrapper:
    """Wrapper for Octotools functionality."""
    
    def __init__(self, engine: str = "gpt-4o", enabled_tools: Optional[List[str]] = None, max_steps: int = 5):
        """Initialize the OctotoolsWrapper.
        
        Args:
            engine: The LLM engine to use
            enabled_tools: List of enabled tools
            max_steps: Maximum number of steps for solving tasks
        """
        self.engine = engine
        self.enabled_tools = enabled_tools or []
        self.max_steps = max_steps
        
        # Initialize components
        self.executor = Executor(llm_engine_name=engine)
        self.planner = Planner(
            llm_engine_name=engine,
            available_tools=self.enabled_tools
        )
        self.memory = Memory() 

    def process_query(self, query: str, debug: bool = False) -> str:
        """Process a user query using Octotools.
        
        Args:
            query: The user's query
            debug: Whether to print debug information
            
        Returns:
            Response from processing the query
        """
        try:
            # Get base response from planner
            response = self.planner.generate_base_response(query, image=None)
            if debug:
                print(f"Base response: {response}")
            
            # Execute tools if needed
            if self.enabled_tools:
                tool_responses = []
                for tool_name in self.enabled_tools:
                    result = self.executor.execute_tool(
                        tool_name=tool_name,
                        context=response,
                        sub_goal=query
                    )
                    tool_responses.append(result)
                    
                    if debug:
                        print(f"Tool {tool_name} response: {result}")
                
                # Combine responses
                final_response = " ".join([response] + tool_responses)
                return final_response
            
            return response
            
        except Exception as e:
            print(f"Error processing query: {str(e)}")
            return f"Error: {str(e)}" 