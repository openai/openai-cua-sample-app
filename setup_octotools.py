#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Setup utility for Octotools integration with CUA-SAMPLE-APP.

This script helps users configure their environment for using the Octotools
integration by creating a proper .env file and verifying requirements.
"""

import os
import sys
import subprocess
import traceback
from typing import Dict, List, Optional, Tuple
from pathlib import Path


def check_python_version() -> bool:
    """
    Check if the Python version is compatible.
    
    Returns:
        bool: True if Python version is compatible, False otherwise
    """
    major, minor = sys.version_info.major, sys.version_info.minor
    print(f"Python version: {major}.{minor}")
    
    if major != 3 or minor < 8:
        print("❌ Python 3.8+ is required")
        print(f"Current Python version: {major}.{minor}")
        return False
    
    print("✅ Python version check passed")
    return True


def check_api_key() -> Tuple[bool, Optional[str]]:
    """
    Check if the OpenAI API key is set in environment variables or .env file.
    
    Returns:
        Tuple[bool, Optional[str]]: Success status and API key if found
    """
    # Check environment variables first
    api_key = os.environ.get("OPENAI_API_KEY")
    
    # If not in environment, check .env file
    if not api_key:
        env_path = Path('.env')
        if env_path.exists():
            with open(env_path, 'r') as f:
                for line in f:
                    if line.strip().startswith('OPENAI_API_KEY='):
                        api_key = line.strip().split('=', 1)[1].strip().strip('"\'')
                        break
    
    if api_key:
        masked_key = f"{api_key[:10]}...{api_key[-5:]}"
        print(f"✅ OpenAI API Key found: {masked_key}")
        return True, api_key
    else:
        print("❌ OpenAI API Key not found")
        return False, None


def create_env_file(api_key: Optional[str] = None) -> bool:
    """
    Create or update the .env file with necessary configurations.
    
    Args:
        api_key: Optional API key to include in the file
        
    Returns:
        bool: True if .env file was created/updated successfully, False otherwise
    """
    env_path = Path('.env')
    
    # Read existing .env file if it exists
    existing_vars = {}
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    existing_vars[key] = value.strip('"\'')
    
    # Ask for API key if not provided
    if not api_key:
        api_key = input("Enter your OpenAI API Key: ").strip()
        if not api_key:
            print("❌ No API key provided")
            return False
    
    # Update variables
    existing_vars["OPENAI_API_KEY"] = api_key
    existing_vars.setdefault("OCTOTOOLS_MODEL", "gpt-4o")
    existing_vars.setdefault("CUA_MODEL", "gpt-4o")
    existing_vars.setdefault("OCTOTOOLS_TOOLS", "Generalist_Solution_Generator_Tool")
    existing_vars.setdefault("REASONING_THRESHOLD", "0.7")
    
    # Write updated .env file
    with open(env_path, 'w') as f:
        for key, value in existing_vars.items():
            f.write(f"{key}={value}\n")
    
    print(f"✅ .env file created/updated at: {env_path.absolute()}")
    return True


def check_requirements() -> bool:
    """
    Check if required packages are installed.
    
    Returns:
        bool: True if all required packages are installed, False otherwise
    """
    required_packages = [
        "playwright",
        "python-dotenv",
        "openai>=1.0.0",
    ]
    
    missing_packages = []
    
    for package in required_packages:
        try:
            if "=" in package:
                pkg_name = package.split("=")[0]
            else:
                pkg_name = package
            
            __import__(pkg_name)
            print(f"✅ {package} is installed")
        except ImportError:
            missing_packages.append(package)
            print(f"❌ {package} is not installed")
    
    if missing_packages:
        print("\nMissing packages:")
        for package in missing_packages:
            print(f"  - {package}")
        
        install = input("Do you want to install missing packages? (y/n): ").strip().lower()
        if install == 'y':
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing_packages)
                print("✅ Packages installed successfully")
                return True
            except subprocess.CalledProcessError:
                print("❌ Failed to install packages")
                return False
        else:
            print("⚠️ Packages not installed")
            return False
    
    return True


def main() -> int:
    """
    Main function to run the setup utility.
    
    Returns:
        int: Exit code (0 for success, 1 for failure)
    """
    print("=== Octotools Integration Setup ===\n")
    
    try:
        # Check Python version
        if not check_python_version():
            print("\n⚠️ Python version check failed. Please use Python 3.8+")
            return 1
        
        # Check API key
        api_key_exists, api_key = check_api_key()
        
        # Create/update .env file
        if not create_env_file(api_key):
            print("\n⚠️ Failed to create .env file")
            return 1
        
        # Check requirements
        if not check_requirements():
            print("\n⚠️ Some requirements are missing")
            # Continue anyway, just warn the user
        
        print("\n=== Setup Complete ===")
        print("You can now use the Octotools integration with CUA-SAMPLE-APP")
        print("Try running the demo script: ./demo_octotools.py")
        
        return 0
    
    except KeyboardInterrupt:
        print("\n⚠️ Setup canceled by user")
        return 1
    except Exception as e:
        print(f"\n❌ An error occurred: {str(e)}")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main()) 