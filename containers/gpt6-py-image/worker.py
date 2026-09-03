import base64
import contextlib
import io
import json
import sys
import time

# Xlib can print display-auth diagnostics during import. Reserve stdout for JSON.
with contextlib.redirect_stdout(sys.stderr):
    import pyautogui
    from PIL import Image

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.1
output = []
output_bytes = 0


def append(item):
    global output_bytes
    output_bytes += len(json.dumps(item).encode())
    if output_bytes > 16 * 1024 * 1024 or len(output) >= 100:
        raise ValueError("Output limit exceeded")
    output.append(item)


def log(value):
    append({"type": "input_text", "text": str(value)[:12000]})


def display(image):
    if not isinstance(image, Image.Image):
        raise TypeError("display expects a PIL image")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    append(
        {
            "type": "input_image",
            "image_url": "data:image/png;base64,"
            + base64.b64encode(buffer.getvalue()).decode(),
            "detail": "original",
        }
    )


# The container is the isolation boundary. This dictionary preserves variables.
scope = {"pyautogui": pyautogui, "time": time, "log": log, "display": display}
pyautogui.screenshot()  # Fail startup if the X11 screenshot dependencies are missing.
print('{"ready":true}', flush=True)
for line in sys.stdin:
    output = []
    output_bytes = 0
    fatal = False
    try:
        code = json.loads(line)["code"]
        with contextlib.redirect_stdout(sys.stderr):
            exec(compile(code, "<exec_py>", "exec"), scope, scope)
    except pyautogui.FailSafeException:
        fatal = True
        log("PyAutoGUI fail-safe triggered. Restart the container to continue.")
    except Exception as error:
        output.append(
            {"type": "input_text", "text": f"Execution error: {error}"[:12000]}
        )
    if not output:
        log("Execution completed.")
    print(json.dumps({"output": output, "fatal": fatal}), flush=True)
    if fatal:
        break
