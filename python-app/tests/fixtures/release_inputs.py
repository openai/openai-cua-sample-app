import json

# No desktop backend is imported or called by routine tests.
print(json.dumps({"released": True}), flush=True)
