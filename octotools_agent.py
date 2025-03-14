#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Octotools agent for CUA-SAMPLE-APP.

This module provides an agent class that integrates Octotools
capabilities with the CUA-SAMPLE-APP framework.
"""

from typing import Optional, Dict, Any, List
import os
import json
from PIL import Image
import io
import traceback

from octotools_wrapper import OctotoolsWrapper
from agent.agent import Agent

class OctotoolsAgent(Agent):
    """Agent class that integrates Octotools capabilities."""
    
    def __init__(
        self,
        model_string: str = "gpt-4-turbo-preview",
        enabled_tools: Optional[List[str]] = None,
        debug: bool = False
    ) -> None:
        """Initialize the OctotoolsAgent.
        
        Args:
            model_string: The language model to use
            enabled_tools: List of tool names to enable
            debug: Whether to print debug information
        """
        super().__init__()
        self.debug = debug
        self.octotools = OctotoolsWrapper(
            engine=model_string,
            enabled_tools=enabled_tools
        )
        
    def run_full_turn(
        self,
        input_items: List[Dict[str, Any]],
        print_steps: bool = True,
        debug: bool = False,
        show_images: bool = False
    ) -> List[Dict[str, Any]]:
        """Run a full turn of the agent.
        
        Args:
            input_items: List of input items
            print_steps: Whether to print steps
            debug: Whether to enable debug output
            show_images: Whether to display images
            
        Returns:
            List of output items
        """
        try:
            # Get the latest user message
            latest_user_message = None
            for item in reversed(input_items):
                if item.get("role") == "user":
                    latest_user_message = item.get("content", "")
                    break
            
            if not latest_user_message:
                return []
            
            # Process the query using Octotools
            result = self.octotools.solve(
                query=latest_user_message,
                image_data=None,
                context=None
            )
            
            # Format the response
            response_items = []
            if result and "answer" in result:
                response = result["answer"]
                
                if debug:
                    # Add debug information
                    debug_info = "\n\nDebug Information:"
                    debug_info += "\nSteps taken:"
                    for step in result.get("steps", []):
                        debug_info += f"\n- Step {step['step']}: {step['sub_goal']} (using {step['tool']})"
                        debug_info += f"\n  Result: {step['result']}"
                    
                    debug_info += f"\n\nTools used: {', '.join(result.get('tools_used', []))}"
                    debug_info += f"\n\nReasoning: {result.get('reasoning', 'No reasoning provided')}"
                    
                    response += debug_info
                
                response_items.append({
                    "role": "assistant",
                    "content": response
                })
            else:
                response_items.append({
                    "role": "assistant",
                    "content": "I apologize, but I couldn't generate a response for your query."
                })
            
            return response_items
            
        except Exception as e:
            if debug:
                traceback.print_exc()
            return [{
                "role": "assistant",
                "content": f"An error occurred while processing your request: {str(e)}"
            }]

    def process_input(self, user_input: str) -> None:
        """Process user input using Octotools.
        
        Args:
            user_input: The user's input query
        """
        try:
            if self.debug:
                print(f"Processing input: {user_input}")
            
            response = self.octotools.process_query(user_input, debug=self.debug)
            print(f"Response: {response}")
            
        except Exception as e:
            print(f"Error processing input: {str(e)}")
            if self.debug:
                traceback.print_exc()

# Example usage
def run_octotools_agent():
    """Run an example of the OctotoolsAgent."""
    from computers import LocalPlaywrightComputer
    
    try:
        with LocalPlaywrightComputer() as computer:
            agent = OctotoolsAgent(
                computer=computer,
                octotools_engine="gpt-4o",
                octotools_tools=["Generalist_Solution_Generator_Tool"],
                debug=True
            )
            
            items = []
            print("OctotoolsAgent initialized. Type 'exit' to quit.")
            
            while True:
                user_input = input("> ")
                if user_input.lower() == 'exit':
                    break
                
                # Add the user input to the items
                items.append({"role": "user", "content": user_input})
                
                # Run the agent
                output_items = agent.run_full_turn(items, debug=True, show_images=True)
                
                # Add the output items to the conversation
                items.extend(output_items)
                
                # Print the assistant's response
                for item in output_items:
                    if item.get("role") == "assistant":
                        print(f"\nAssistant: {item.get('content')}\n")
    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    run_octotools_agent() 