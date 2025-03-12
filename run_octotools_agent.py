#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Script to run the OctotoolsAgent.

This script loads environment variables and runs the OctotoolsAgent
for testing and demonstration purposes.
"""

import os
import sys
from octotools_agent import OctotoolsAgent
from computers import LocalPlaywrightComputer
from dotenv import load_dotenv
import argparse


def main():
    """
    Run the OctotoolsAgent with environment variables.
    """
    # Load environment variables from .env file
    load_dotenv()
    
    # Ensure the API key is set
    if "OPENAI_API_KEY" not in os.environ:
        print("❌ ERROR: OPENAI_API_KEY environment variable is not set.")
        print("Please make sure you have a .env file with the API key or set it manually.")
        return 1
    
    print(f"API Key is {'configured' if os.environ.get('OPENAI_API_KEY') else 'NOT configured'}")
    
    parser = argparse.ArgumentParser(description="Run OctotoolsAgent with configuration options")
    parser.add_argument('--engine', default="gpt-4o", help='LLM engine for Octotools (default: gpt-4o)')
    parser.add_argument('--tools', nargs='+', default=[
        "Python_Code_Generator_Tool",
        "Text_Detector_Tool",
        "Image_Captioner_Tool",
        "Object_Detector_Tool",
        "Google_Search_Tool",
        "Generalist_Solution_Generator_Tool"
    ], help='List of Octotools tools to enable')
    parser.add_argument('--test-mode', action='store_true', help='Run a simple test without computer interaction')
    args = parser.parse_args()
    
    # Test mode doesn't require browser automation
    if args.test_mode:
        test_octotools_agent(args.engine, args.tools)
        return 0
    
    # Regular mode with browser automation
    with LocalPlaywrightComputer() as computer:
        try:
            print(f"Initializing OctotoolsAgent with engine: {args.engine}")
            print(f"Enabled tools: {', '.join(args.tools)}")
            
            # Create the agent
            agent = OctotoolsAgent(
                computer=computer,
                octotools_engine=args.engine,
                octotools_tools=args.tools
            )
            
            print("\n=== OctotoolsAgent Initialized Successfully ===")
            print("Type 'exit' to quit")
            
            items = []
            while True:
                user_input = input("\n> ")
                if user_input.lower() == 'exit':
                    break
                    
                items.append({"role": "user", "content": user_input})
                output_items = agent.run_full_turn(items, debug=True, show_images=True)
                items += output_items
                
        except Exception as e:
            print(f"\n❌ Error running OctotoolsAgent: {str(e)}")
            import traceback
            traceback.print_exc()
            return 1
    
    return 0


def test_octotools_agent(engine, tools):
    """
    Run a simple test of the OctotoolsAgent without browser automation.
    
    Args:
        engine: LLM engine to use
        tools: List of tools to enable
    """
    print("\n=== Testing OctotoolsAgent without browser automation ===")
    
    try:
        # Create agent without computer
        agent = OctotoolsAgent(
            octotools_engine=engine,
            octotools_tools=tools
        )
        
        test_query = "Calculate the square root of 144."
        print(f"\nSending test query: '{test_query}'")
        
        items = [{"role": "user", "content": test_query}]
        output_items = agent.run_full_turn(items, debug=True, show_images=False)
        
        print("\nResponse:")
        for item in output_items:
            if item.get("role") == "assistant":
                print(item.get("content", "No content"))
        
        print("\n✅ OctotoolsAgent test PASSED!")
        
    except Exception as e:
        print(f"\n❌ OctotoolsAgent test FAILED with error: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    sys.exit(main()) 