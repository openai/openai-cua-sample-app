"""
Example demonstrating the PyAutoGUIComputer for controlling the local desktop.
"""

from agent.agent import Agent
from computers import PyAutoGUIComputer

def acknowledge_safety_check_callback(message: str) -> bool:
    """Callback for safety check acknowledgment."""
    response = input(
        f"Safety Check Warning: {message}\nDo you want to acknowledge and proceed? (y/n): "
    ).lower()
    return response.lower().strip() == "y"

def main():
    """Main function to run the PyAutoGUI desktop agent."""
    print("Initializing PyAutoGUI Desktop Control")
    print("=====================================")
    print("This example allows an agent to control your desktop using PyAutoGUI.")
    print("Move mouse to upper-left corner (0,0) to abort if needed.")
    print()
    
    with PyAutoGUIComputer() as computer:
        agent = Agent(
            computer=computer,
            acknowledge_safety_check_callback=acknowledge_safety_check_callback,
        )
        
        items = []
        
        print("Desktop agent ready. Type 'exit' to quit.")
        print("Example commands:")
        print(" - 'Open a calculator'")
        print(" - 'Create a new text file on the desktop'")
        print(" - 'Take a screenshot and tell me what you see'")
        
        while True:
            try:
                user_input = input("> ")
                if user_input.lower() == 'exit':
                    break
            except EOFError as e:
                print(f"An error occurred: {e}")
                break
                
            items.append({"role": "user", "content": user_input})
            # Using custom show_images parameter for the PyAutoGUI example
            # This will use the non-intrusive matplotlib display method
            output_items = agent.run_full_turn(
                items,
                print_steps=True,
                show_images=True,  # Will use our modified non-intrusive display
                debug=False,
            )
            items += output_items

if __name__ == "__main__":
    main()