#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Simple Octotools Wrapper.

This module provides direct access to Octotools functionality by importing
directly from the local repository structure.
"""

import os
import sys
import json
import base64
import tempfile
import traceback
from typing import Dict, List, Any, Optional, Union
from dotenv import load_dotenv

# Get the absolute path to the octotools repository
OCTOTOOLS_REPO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'octotools')
OCTOTOOLS_PACKAGE_PATH = os.path.join(OCTOTOOLS_REPO_PATH, 'octotools')

# Add paths to sys.path
sys.path.insert(0, OCTOTOOLS_REPO_PATH)
sys.path.insert(0, OCTOTOOLS_PACKAGE_PATH)

# Dictionary of available tool classes with their path in the repository
AVAILABLE_TOOLS = {
    "Python_Code_Generator_Tool": os.path.join(OCTOTOOLS_PACKAGE_PATH, "tools/python_code_generator/PythonCodeGeneratorTool.py"),
    "Generalist_Solution_Generator_Tool": os.path.join(OCTOTOOLS_PACKAGE_PATH, "tools/generalist_solution_generator/GeneralistSolutionGeneratorTool.py"),
    "Image_Caption_Tool": os.path.join(OCTOTOOLS_PACKAGE_PATH, "tools/image_captioner/ImageCaptionTool.py")
}


class SimpleOctotoolsWrapper:
    """
    A simplified wrapper for Octotools.
    
    This class uses direct calls to the OpenAI API to simulate
    Octotools functionality without relying on complex imports.
    """
    
    def __init__(
        self, 
        llm_engine: str = "gpt-4o", 
        enabled_tools: Optional[List[str]] = None,
        max_steps: int = 3
    ) -> None:
        """
        Initialize the simple Octotools wrapper.
        
        Args:
            llm_engine: The language model engine to use (default: "gpt-4o")
            enabled_tools: List of tools to enable (not used in simplified version)
            max_steps: Maximum number of steps to take when solving (default: 3)
        """
        # Load environment variables
        load_dotenv()
        
        # Check API key
        self.api_key = os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        
        self.llm_engine = llm_engine
        self.max_steps = max_steps
        
        # Set default tools if none provided
        if enabled_tools is None:
            enabled_tools = ["Generalist_Solution_Generator_Tool"]
        
        # Filter to only include available tools
        self.enabled_tools = [tool for tool in enabled_tools if tool in AVAILABLE_TOOLS]
        
        print(f"Initialized SimpleOctotoolsWrapper with model {llm_engine}")
        print(f"Enabled tools: {', '.join(self.enabled_tools)}")
    
    def solve(
        self, 
        query: str, 
        image_data: Optional[str] = None,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Solve a task using direct calls to the OpenAI API.
        
        Args:
            query: The user's query
            image_data: Optional base64-encoded image data
            context: Optional additional context for the solver
        
        Returns:
            A dictionary containing the result of the solving process
        """
        try:
            print(f"Solving query: {query}")
            
            # Process the image if provided
            image_path = None
            if image_data:
                # Save the image temporarily
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
            
            # Prepare system prompt
            system_prompt = self._get_system_prompt()
            
            # Prepare user prompt
            user_prompt = self._get_user_prompt(full_query, image_path)
            
            # Create messages for API call
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
            
            # Make direct API call to OpenAI
            import requests
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"
            }
            
            data = {
                "model": self.llm_engine,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 1000
            }
            
            # Add image content if provided
            if image_path:
                # Convert user message to include image
                encoded_image = self.encode_image_to_base64(image_path)
                if encoded_image:
                    # Update user message to include image
                    messages[1] = {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"}}
                        ]
                    }
                    data["messages"] = messages
            
            # Make the API call
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=data
            )
            
            # Process the response
            if response.status_code == 200:
                result = response.json()
                answer = result["choices"][0]["message"]["content"]
                
                # Format the result
                formatted_result = {
                    "answer": answer,
                    "steps": [
                        {
                            "tool_used": self.enabled_tools[0],
                            "sub_goal": "Process the query and generate a response",
                            "result": answer
                        }
                    ]
                }
                
                return formatted_result
            else:
                error_message = f"API Error: {response.status_code} - {response.text}"
                print(error_message)
                return {
                    "answer": f"Error: {error_message}",
                    "steps": []
                }
            
        except Exception as e:
            traceback.print_exc()
            print(f"Error in SimpleOctotoolsWrapper.solve: {str(e)}")
            return {
                "answer": f"Error: {str(e)}",
                "steps": []
            }
        finally:
            # Clean up temporary file if created
            if image_path and os.path.exists(image_path):
                os.remove(image_path)
    
    def _get_system_prompt(self) -> str:
        """Get the system prompt for the language model."""
        return """You are OctoTools, an AI agent designed to solve complex problems.
        
You have access to various tools to help solve problems:
- Python_Code_Generator_Tool: Generate Python code to solve programming problems
- Generalist_Solution_Generator_Tool: Generate solutions to general problems
- Image_Caption_Tool: Caption and analyze images

Break down the problem into steps, think about it carefully, and provide a detailed solution.
"""
    
    def _get_user_prompt(self, query: str, image_path: Optional[str] = None) -> str:
        """Get the user prompt including the query and any context about images."""
        prompt = f"Query: {query}\n\n"
        
        if image_path:
            prompt += "Note: This query includes an image which I've analyzed for you.\n"
        
        return prompt
    
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
            print(f"Error encoding image: {str(e)}")
            return "" 