import contextlib
import io
import json
import os
import sys
import time

print(json.dumps({'ready': True, 'platform': sys.platform}), flush=True)
namespace = {'os': os, 'time': time}
for line in sys.stdin:
    request = json.loads(line)
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            exec(request['code'], namespace)
        output = captured.getvalue()
    except Exception as error:
        output = str(error)
    print(json.dumps({'output': [{'type': 'input_text', 'text': output}]}), flush=True)
