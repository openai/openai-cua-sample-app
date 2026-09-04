"""Persistent local PyAutoGUI REPL. The app owns browser setup and verification."""
import base64
import contextlib
import ctypes
import io
import json
import os
import signal
import sys
import threading
import time
import traceback

from PIL import Image

def emit(payload):
    sys.__stdout__.write(json.dumps(payload) + "\n")
    sys.__stdout__.flush()


def check_desktop(pyautogui):
    width, height = pyautogui.size()
    if width <= 0 or height <= 0:
        raise RuntimeError("No local desktop is available. Start the runner in a graphical desktop session.")
    if sys.platform == "darwin":
        services = ctypes.CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
        services.AXIsProcessTrusted.restype = ctypes.c_bool
        if not services.AXIsProcessTrusted():
            raise RuntimeError("macOS Accessibility permission is required for PyAutoGUI. Enable the app launching the runner (Terminal or Codex) in System Settings > Privacy & Security > Accessibility, then retry.")
        import Quartz
        if not Quartz.CGPreflightScreenCaptureAccess():
            raise RuntimeError("macOS Screen Recording permission is required. Enable the app launching the runner in System Settings > Privacy & Security > Screen Recording, then restart it.")
    return width, height


def normalize_screenshots(pyautogui):
    # Retina screenshots use physical pixels while input uses logical points.
    # Return images in the same coordinate system as click/moveTo/dragTo.
    capture = pyautogui.screenshot

    def screenshot(imageFilename=None, region=None, **kwargs):
        image = capture(**kwargs)
        size = tuple(pyautogui.size())
        if image.size != size:
            image = image.resize(size, Image.Resampling.LANCZOS)
        if region is not None:
            x, y, width, height = region
            image = image.crop((x, y, x + width, y + height))
        if imageFilename is not None:
            image.save(imageFilename)
        return image

    pyautogui.screenshot = screenshot


def execute(code, namespace):
    output = []
    text_bytes = 0
    image_bytes = 0

    def log(*values):
        nonlocal text_bytes
        text = " ".join(str(value) for value in values)
        text_bytes += len(text.encode("utf-8"))
        if text_bytes > 60 * 1024 or len(output) >= 250:
            raise ValueError("Python text output exceeds its size limit.")
        output.append({"type": "input_text", "text": text})

    def display(value):
        nonlocal image_bytes
        if isinstance(value, Image.Image):
            buffer = io.BytesIO()
            value.save(buffer, format="PNG")
            value = buffer.getvalue()
        if not isinstance(value, bytes) or not value.startswith(b"\x89PNG\r\n\x1a\n"):
            raise TypeError("display expects a Pillow image or PNG bytes.")
        image_bytes += len(value)
        if image_bytes > 8 * 1024 * 1024 or len(output) >= 250:
            raise ValueError("Python image output exceeds its size limit.")
        output.append({"type": "input_image", "detail": "original", "image_url": "data:image/png;base64," + base64.b64encode(value).decode("ascii")})

    class Writer:
        def write(self, text):
            if text.strip():
                log(text)
            return len(text)

        def flush(self):
            pass

    namespace.update(log=log, display=display)
    try:
        with contextlib.redirect_stdout(Writer()), contextlib.redirect_stderr(Writer()):
            exec(compile(code, "<exec_py>", "exec"), namespace)
    except BaseException as error:
        failsafe = getattr(namespace.get("pyautogui"), "FailSafeException", ())
        if isinstance(error, failsafe):
            return {"error": {"code": "python_failsafe", "message": "Desktop fail-safe activated."}}
        # Preserve partial output and globals so the model can correct its code.
        output.append({"type": "input_text", "text": traceback.format_exc()[-4000:]})
    return {"output": output or [{"type": "input_text", "text": "exec_py completed with no output."}]}


def serve_requests(namespace, stream):
    terminal_error = None
    for line in stream:
        if len(line.encode("utf-8")) > 512 * 1024:
            raise ValueError("Python request exceeds its size limit.")
        request = json.loads(line)
        if not isinstance(request, dict):
            raise ValueError("Python request must be an object.")
        operation = request.get("operation")
        if operation == "close":
            return
        if terminal_error is not None:
            emit({"id": request.get("id"), "error": terminal_error})
            continue
        if operation != "execute":
            emit({"id": request.get("id"), "error": {
                "code": "unsupported_python_operation",
                "message": "Only the execute operation is supported.",
            }})
            continue
        code = request.get("code")
        if not isinstance(code, str) or not code.strip() or len(code.encode("utf-8")) > 64 * 1024:
            raise ValueError("Python code must be nonempty and at most 64 KiB.")
        result = execute(code, namespace)
        terminal_error = result.get("error")
        emit({"id": request.get("id"), **result})


def check_screenshot(pyautogui, expected_size):
    image = pyautogui.screenshot()
    if tuple(pyautogui.size()) != expected_size or image.size != expected_size:
        raise RuntimeError("Desktop screenshot dimensions changed. Start a new run.")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    if len(buffer.getvalue()) > 8 * 1024 * 1024:
        raise RuntimeError("Desktop screenshot exceeds 8 MiB.")


def main():
    import pyautogui
    width, height = check_desktop(pyautogui)
    normalize_screenshots(pyautogui)
    check_screenshot(pyautogui, (width, height))
    namespace = {"__builtins__": __builtins__, "pyautogui": pyautogui}
    emit({"ready": True, "platform": sys.platform, "width": width, "height": height})
    if "--check" in sys.argv:
        return
    if os.name != "nt":
        parent = os.getppid()

        def watch_parent():
            while True:
                time.sleep(1)
                if os.getppid() != parent:
                    os.killpg(os.getpgrp(), signal.SIGKILL)

        threading.Thread(target=watch_parent, daemon=True).start()
    serve_requests(namespace, sys.stdin)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        emit({"error": f"{type(error).__name__}: {error}"[:4000]})
        sys.exit(1)
