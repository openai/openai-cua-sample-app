"""Release desktop input after the action worker has exited. Never execute model code."""

import ctypes
import json
import sys
import time


def release_inputs(key_codes, key_up, mouse_up):
    """Attempt every release, including when one backend operation fails."""
    errors = []
    for key in dict.fromkeys(key_codes):
        try:
            key_up(key)
        except Exception as error:  # noqa: BLE001 - One failed release must not skip the remaining inputs.
            errors.append(f"key {key}: {error}")
    for button in (1, 2, 3):
        try:
            mouse_up(button)
        except Exception as error:  # noqa: BLE001 - Attempt all mouse buttons even after an OS error.
            errors.append(f"button {button}: {error}")
    if errors:
        raise RuntimeError("; ".join(errors)[:2000])


def release_macos():
    import Quartz

    services = ctypes.CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
    services.AXIsProcessTrusted.restype = ctypes.c_bool
    if not services.AXIsProcessTrusted():
        raise RuntimeError("Accessibility permission is required to release desktop input.")
    position = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))

    def post(event, clear_flags=False):
        if event is None:
            raise RuntimeError("Could not create an input release event.")
        if clear_flags:
            Quartz.CGEventSetFlags(event, 0)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)

    def mouse_up(button):
        event_type, native_button = {
            1: (Quartz.kCGEventLeftMouseUp, Quartz.kCGMouseButtonLeft),
            2: (Quartz.kCGEventOtherMouseUp, Quartz.kCGMouseButtonCenter),
            3: (Quartz.kCGEventRightMouseUp, Quartz.kCGMouseButtonRight),
        }[button]
        # Quartz creates events using current input state. Let prior releases
        # settle before constructing the next event, as PyAutoGUI does on macOS.
        time.sleep(0.01)
        post(Quartz.CGEventCreateMouseEvent(None, event_type, position, native_button))

    release_inputs(range(128), lambda key: post(Quartz.CGEventCreateKeyboardEvent(None, key, False), True), mouse_up)
    # CGEventPost is asynchronous and has no result. Do not acknowledge cleanup
    # until the desktop has observed all three mouse releases.
    deadline = time.monotonic() + 0.3
    while True:
        held = [
            button
            for button in (Quartz.kCGMouseButtonLeft, Quartz.kCGMouseButtonCenter, Quartz.kCGMouseButtonRight)
            if Quartz.CGEventSourceButtonState(Quartz.kCGEventSourceStateCombinedSessionState, button)
        ]
        if not held:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Mouse buttons remain held after input release: {held}.")
        time.sleep(0.01)


def release_x11():
    from Xlib import X, display
    from Xlib.ext.xtest import fake_input

    connection = display.Display()
    try:
        try:
            release_inputs(
                range(8, 256),
                lambda key: fake_input(connection, X.KeyRelease, key),
                lambda button: fake_input(connection, X.ButtonRelease, button),
            )
        finally:
            connection.sync()
    finally:
        connection.close()


def release_windows():
    from ctypes import wintypes

    class KeyboardInput(ctypes.Structure):
        _fields_ = [
            ("vk", wintypes.WORD),
            ("scan", wintypes.WORD),
            ("flags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("extra", ctypes.c_size_t),
        ]

    class MouseInput(ctypes.Structure):
        _fields_ = [
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("data", wintypes.DWORD),
            ("flags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("extra", ctypes.c_size_t),
        ]

    class Payload(ctypes.Union):
        _fields_ = [("keyboard", KeyboardInput), ("mouse", MouseInput)]

    class Input(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("payload", Payload)]

    send = ctypes.windll.user32.SendInput  # type: ignore[attr-defined]
    send.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
    send.restype = wintypes.UINT

    def post(event):
        if send(1, ctypes.byref(event), ctypes.sizeof(Input)) != 1:
            raise RuntimeError("Windows rejected an input release; check desktop permissions.")

    # Raw virtual-key releases avoid PyAutoGUI keyUp's implicit modifier presses.
    extended = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0x6F, 0x90, 0xA3, 0xA5}
    release_inputs(
        range(8, 255),
        lambda key: post(Input(1, Payload(keyboard=KeyboardInput(key, 0, 2 | (key in extended), 0, 0)))),
        lambda button: post(Input(0, Payload(mouse=MouseInput(0, 0, 0, {1: 4, 2: 64, 3: 16}[button], 0, 0)))),
    )


def main():
    # These backends emit only up events. No screenshot, focus change, or
    # PyAutoGUI fail-safe check can prevent release at a screen corner.
    if sys.platform == "darwin":
        release_macos()
    elif sys.platform == "win32":
        release_windows()
    elif sys.platform.startswith("linux"):
        release_x11()
    else:
        raise RuntimeError(f"Input release is unsupported on {sys.platform}.")


if __name__ == "__main__":
    try:
        main()
        print(json.dumps({"released": True}), flush=True)
    except Exception as error:  # noqa: BLE001 - Acknowledge every OS cleanup failure to the parent.
        print(json.dumps({"error": str(error)[:2000]}), flush=True)
        sys.exit(1)
