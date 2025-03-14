from agent import Agent
from computers import PigWindows

prompt = """
Open Excel, set A1 to 1, A2 to 2, and then calculate the sum in A3. 
No need to get permission to start work on the sheet.
"""

with PigWindows() as computer:
    agent = Agent(computer=computer)
    input_items = [{"role": "user", "content": prompt}]
    response_items = agent.run_full_turn(input_items, debug=True, show_images=True)
    print(response_items[-1]["content"][0]["text"])
