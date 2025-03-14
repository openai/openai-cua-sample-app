#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Main entry point for the CUA-SAMPLE-APP with Octotools integration.

This module initializes and runs the agent with optional Octotools
integration for enhanced reasoning capabilities.
"""

import os
import signal
import sys
import argparse
from dotenv import load_dotenv
from typing import NoReturn

from computers import LocalPlaywrightComputer
from agent.agent import Agent
from octotools_agent import OctotoolsAgent

def signal_handler(signum: int, frame: object) -> NoReturn:
    """Handle shutdown signals.
    
    Args:
        signum: Signal number
        frame: Current stack frame
    """
    print("\nShutting down gracefully...")
    sys.exit(0)

def main(debug: bool = False, use_octotools: bool = False) -> None:
    """
    Run the main application loop.
    
    Args:
        debug: Whether to enable debug output
        use_octotools: Whether to use Octotools integration
    """
    print("Initializing agent with Octotools integration...")
    agent = OctotoolsAgent(
        model_string="gpt-4o",
        enabled_tools=[
            "Generalist_Solution_Generator_Tool",
            "Python_Code_Generator_Tool",
            "Text_Detector_Tool",
            "URL_Text_Extractor_Tool",
            "Nature_News_Fetcher_Tool"
        ],
        debug=debug
    )
    
    # Set up signal handler for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    
    # Main interaction loop
    while True:
        try:
            user_input = input("\nEnter your query (or 'exit' to quit): ")
            if user_input.lower() == "exit":
                break
                
            agent.process_input(user_input)
            
        except Exception as e:
            print(f"Error: {str(e)}")
            if debug:
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    # Load environment variables
    load_dotenv()
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Run CUA-SAMPLE-APP with optional Octotools integration")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    parser.add_argument("--use-octotools", action="store_true", help="Use Octotools integration")
    args = parser.parse_args()
    
    # Run the main application
    main(debug=args.debug, use_octotools=args.use_octotools)
