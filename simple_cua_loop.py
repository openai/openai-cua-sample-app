from computers import Computer
from computers import LocalPlaywrightComputer
from utils import create_response, check_blocklisted_url


def acknowledge_safety_check_callback(message: str) -> bool:
    response = input(
        f"Safety Check Warning: {message}\nDo you want to acknowledge and proceed? (y/n): "
    ).lower()
    return response.strip() == "y"


def handle_item(item, computer: Computer):
    """Handle each item; may cause a computer action + screenshot."""
    if item["type"] == "message":  # print messages
        print(item["content"][0]["text"])

    if item["type"] == "computer_call":  # perform computer actions
        action = item["action"]
        action_type = action["type"]
        action_args = {k: v for k, v in action.items() if k != "type"}
        print(f"{action_type}({action_args})")

        # give our computer environment action to perform
        getattr(computer, action_type)(**action_args)

        screenshot_base64 = computer.screenshot()

        pending_checks = item.get("pending_safety_checks", [])
        for check in pending_checks:
            if not acknowledge_safety_check_callback(check["message"]):
                raise ValueError(f"Safety check failed: {check['message']}")

        # return value informs model of the latest screenshot
        call_output = {
            "type": "computer_call_output",
            "call_id": item["call_id"],
            "acknowledged_safety_checks": pending_checks,
            "output": {
                "type": "input_image",
                "image_url": f"data:image/png;base64,{screenshot_base64}",
            },
        }

        # additional URL safety checks for browser environments
        if computer.environment == "browser":
            current_url = computer.get_current_url()
            call_output["output"]["current_url"] = current_url
            check_blocklisted_url(current_url)

        return [call_output]

    return []


def main():
    """Run the CUA (Computer Use Assistant) loop, using Local Playwright."""
    with LocalPlaywrightComputer() as computer:
        tools = [
            {
                "type": "computer-preview",
                "display_width": computer.dimensions[0],
                "display_height": computer.dimensions[1],
                "environment": computer.environment,
            }
        ]

        transcript: list[dict] = []
        while True:  # get user input forever
            user_input = input("> ")
            pending: list[dict] = [{"role": "user", "content": user_input}]
            previous_response_id = None

            while True:
                seen_ids: set[str] = set()
                payload: list[dict] = []
                for m in pending:
                    mid = m.get("id") if isinstance(m, dict) else None
                    if mid and mid in seen_ids:
                        continue
                    if mid:
                        seen_ids.add(mid)
                    payload.append(m)

                req = dict(
                    model="computer-use-preview",
                    input=payload,
                    tools=tools,
                    truncation="auto",
                )
                if previous_response_id:
                    req["previous_response_id"] = previous_response_id

                response = create_response(**req)

                if "output" not in response:
                    print(response)
                    raise ValueError("No output from model")

                previous_response_id = response.get("id")

                new_pending: list[dict] = []

                for item in response["output"]:
                    if item.get("type") == "computer_call":
                        obs = handle_item(item, computer)
                        transcript.append(item)
                        transcript.extend(obs)
                        new_pending.extend(obs)
                        break
                    else:
                        transcript.append(item)

                if new_pending and new_pending[-1].get("role") == "assistant":
                    break

                if not new_pending:
                    break

                pending = new_pending


if __name__ == "__main__":
    main()
