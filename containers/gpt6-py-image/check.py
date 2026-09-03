import contextlib
import subprocess
import sys
import time

for _ in range(100):
    ready = subprocess.run(
        ["xdotool", "search", "--onlyvisible", "--class", "chromium"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if ready.returncode == 0:
        break
    time.sleep(0.2)
else:
    raise SystemExit("Chromium did not become ready within 20 seconds.")

# Xlib may print startup diagnostics. Keep stdout reserved for the PNG.
with contextlib.redirect_stdout(sys.stderr):
    import pyautogui

    pyautogui.FAILSAFE = True
    screenshot = pyautogui.screenshot()
screenshot.save(sys.stdout.buffer, format="PNG")
print(
    f"PASS: PyAutoGUI desktop {screenshot.size}, PNG written to stdout.",
    file=sys.stderr,
)
