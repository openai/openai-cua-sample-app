from agent import Agent
from computers import CuaMacOSComputer

def acknowledge_safety_check_callback(message: str) -> bool:
    """Callback function to handle safety check warnings."""
    print(f"Safety Check Warning: {message}")
    response = input("Do you want to acknowledge and proceed? (y/n): ").lower()
    return response == "y"

def main():
    """Example of using CuaMacOSComputer to interact with Finder and other macOS apps."""
    print("Starting macOS environment...")
    print("Task: Open Finder, create a new folder, and take a screenshot")
    print("This may take a minute to initialize the VM...")
    
    with CuaMacOSComputer() as computer:
        # Create the agent with our computer and safety callback
        agent = Agent(
            computer=computer,
            acknowledge_safety_check_callback=acknowledge_safety_check_callback
        )
        
        # Define the task: interact with macOS Finder
        task = """
        Follow these steps on macOS:
        1. Open Finder
        2. Create a new folder on the Desktop named "CUA Demo"
        3. Open the folder
        4. Open TextEdit and save a file in that folder
        5. Take a screenshot with the keyboard shortcut Command+Shift+3
        """
        
        # Create the input items with our task
        input_items = [{"role": "user", "content": task}]
        
        # Run the agent and get the response items
        print("\nExecuting macOS task...")
        response_items = agent.run_full_turn(
            input_items, 
            debug=True, 
            show_images=True
        )
        
        # Print the final response
        if response_items and response_items[-1].get("role") == "assistant":
            print("\nTask completed!")
            print("Assistant's final response:")
            print(response_items[-1]["content"][0]["text"])
        else:
            print("\nNo final response from assistant.")

if __name__ == "__main__":
    main() 