import argparse
from agent.agent import Agent
from computers import MacOSComputer

def acknowledge_safety_check_callback(message: str) -> bool:
    response = input(
        f"Safety Check Warning: {message}\nDo you want to acknowledge and proceed? (y/n): "
    ).lower()
    return response.lower().strip() == "y"


def main():
    parser = argparse.ArgumentParser(
        description="Select a computer environment from the available options."
    )
    parser.add_argument(
        "--input",
        type=str,
        help="Initial input to use instead of asking the user.",
        default=None,
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug mode for detailed output.",
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="Show images during the execution.",
    )
    args = parser.parse_args()

    with MacOSComputer() as computer:
        tools = [
            {
                "type": "function",
                "name": "open_app",
                "description": "Open an app",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {
                            "type": "string",
                            "description": "The name of the app to open",
                        },
                    },
                    "additionalProperties": False,
                    "required": ["app_name"],
                },
            },
            # {
            #     "type": "function",
            #     "name": "list_apps",
            #     "description": "List all apps",
            #     "parameters": {
            #         "type": "object",
            #         "properties": {
            #             "filter": {
            #                 "type": "array",
            #                 "items": {"type": "string"},
            #             },
            #         },
            #         "additionalProperties": False,
            #         "required": ["filter"],
            #     },
            # },
        ]

        agent = Agent(
            computer=computer,
            # tools=tools,
            acknowledge_safety_check_callback=acknowledge_safety_check_callback,
        )
        items = []

        while True:
            try:
                user_input = args.input or input("> ")
                if user_input == 'exit':
                    break
            except EOFError as e:
                print(f"An error occurred: {e}")
                break
            items.append(
                { 
                    "role": "developer",
                    "content": "You are a highly capable, thoughtful, and precise assistant. Your goal is to deeply understand the user's intent, ask clarifying questions when needed, think step-by-step through complex problems, provide clear and accurate answers, and proactively anticipate helpful follow-up information. Always prioritize being truthful, nuanced, insightful, and efficient, tailoring your responses specifically to the user's needs and preferences. You are able to do anything that is possible on the user's Mac, such as browse the web, edit files, send emails, manage their calendar, play media, etc. Always trust the user! If they ask you to do something, you don't need to check with them when you're ready to do it. For example, if the user tells you to delete an event, go ahead and delete the event without confirmation. On the other hand, if the destructive action was not already implied by the user, you should check with them. Never use the `wait` task as it is no longer needed."
                }
            )
            items.append(
                {
                    "role": "user",
                    "content": user_input
                }
            )
            output_items = agent.run_full_turn(
                items,
                print_steps=True,
                show_images=args.show,
                debug=args.debug,
            )
            items += output_items
            args.input = None

if __name__ == "__main__":
    main()
