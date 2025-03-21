import asyncio
import websockets
import json
import queue
from agent.agent import Agent
from computers import MacOSComputer

# The connect function is our WebSocket handler.
async def connect(websocket):
    # Get the asyncio event loop (needed for scheduling a send from non-async code).
    loop = asyncio.get_running_loop()
    # A thread-safe Queue used to pass safety check responses from the WebSocket thread to the agent thread.
    safety_response_queue = queue.Queue()

    # This function will be passed as a callback to the agent so that it can send status updates.
    # When the agent calls this function, its update will be packaged as {"action": <update_dict>} and sent to the client.
    def status_update_callback(update: dict):
        message = json.dumps(update)
        # Since we're in a different thread than the event loop, we schedule this coroutine thread-safely.
        asyncio.run_coroutine_threadsafe(websocket.send(message), loop)

    # This function will be used by the agent when it needs to ask for a safety confirmation.
    # It sends a JSON message of the form {"safety_check": "message here"} and then waits (blocking) for the client to respond.
    def safety_check_callback(message: str) -> bool:
        print("safety_check_callback", message)
        safety_message = json.dumps({"safety_check": message})
        send_future = asyncio.run_coroutine_threadsafe(websocket.send(safety_message), loop)
        # Wait until the message has been sent.
        send_future.result()
        # Block until the websocket loop receives a response and puts it into the queue.
        response = safety_response_queue.get()  # This is a blocking call running in a background thread.
        print("safety_check_callback response", response)
        return bool(response)

    # This list holds the conversation history.
    conversation_items = []

    # Create the computer environment and agent (using the same tools as our CLI version).
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
            # Additional tool(s) can be defined here.
        ]

        agent = Agent(
            computer=computer,
            # tools=tools,
            acknowledge_safety_check_callback=safety_check_callback,
        )

        processing_turn = False

        # Main receive loop.
        while True:
            try:
                message_str = await websocket.recv()
            except websockets.exceptions.ConnectionClosed:
                print("Connection closed")
                break

            try:
                data = json.loads(message_str)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON message"}))
                continue

            if "reset" in data:
                conversation_items = []
                continue

            # --- Process safety check responses first ---
            if "safety_check_response" in data:
                print("safety_check_response", data["safety_check_response"])
                # The agent is blocking on a safety check confirmation.
                safety_response = data["safety_check_response"]
                safety_response_queue.put(safety_response)
                continue

            # --- Process a new user input ---
            if "input" in data:
                if processing_turn:
                    await websocket.send(
                        json.dumps({"error": "Agent is processing a previous request. Please wait."})
                    )
                    continue

                user_input = data["input"]
                if user_input == "exit":
                    await websocket.send(json.dumps({"message": "Exiting connection."}))
                    break

                processing_turn = True

                # Append the system/developer instructions along with the new user input.
                if not conversation_items:
                    conversation_items.append({
                        "role": "developer",
                        "content": (
                            "You are a highly capable, thoughtful, and precise assistant. Your goal is to deeply understand "
                            "the user's intent, ask clarifying questions when needed, think step-by-step through complex problems, "
                            "provide clear and accurate answers, and proactively anticipate helpful follow-up information. "
                            "Always prioritize being truthful, nuanced, insightful, and efficient, tailoring your responses specifically "
                            "to the user's needs and preferences. You are able to do anything that is possible on the user's Mac, such as "
                            "browse the web, edit files, send emails, manage their calendar, play media, etc. Always trust the user! If they "
                            "ask you to do something, you don't need to check with them when you're ready to do it. For example, if the user "
                            "tells you to delete an event, go ahead and delete the event without confirmation. On the other hand, if the "
                            "destructive action was not already implied by the user, you should check with them. Never use the `wait` task as "
                            "it is no longer needed."
                        )
                    })
                conversation_items.append({
                    "role": "user",
                    "content": user_input
                })

                # Define a function to run the agent’s turn (the call to run_full_turn) in a thread.
                def run_turn():
                    # run_full_turn will call our status_update_callback whenever there is a status update.
                    output_items = agent.run_full_turn(
                        conversation_items,
                        print_steps=True,
                        show_images=False,  # Adjust as needed.
                        debug=False,       # Adjust as needed.
                        status_callback=status_update_callback,
                    )
                    return output_items

                try:
                    # Run the agent turn without blocking the event loop.
                    output_items = await loop.run_in_executor(None, run_turn)
                    conversation_items.extend(output_items)
                except Exception as e:
                    error_msg = json.dumps({"error": str(e)})
                    await websocket.send(error_msg)
                processing_turn = False
            else:
                await websocket.send(
                    json.dumps({
                        "error": "Unrecognized message format. Expecting a JSON with either 'input' or 'safety_check_response'."
                    })
                )

# When run as a script, start the server on port 3333.
async def main():
    async with websockets.serve(connect, "0.0.0.0", 3333):
        print("Server started on port 3333...")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())