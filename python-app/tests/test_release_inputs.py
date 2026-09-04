import ctypes
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.desktop import release_inputs as release


class ReleaseTests(unittest.TestCase):
    def macos_backend(self, events, button_state=None):
        return SimpleNamespace(
            kCGHIDEventTap=0,
            kCGEventLeftMouseUp=1,
            kCGEventOtherMouseUp=2,
            kCGEventRightMouseUp=3,
            kCGMouseButtonLeft=0,
            kCGMouseButtonCenter=2,
            kCGMouseButtonRight=1,
            kCGEventSourceStateCombinedSessionState=0,
            CGEventCreate=lambda _: {},
            CGEventGetLocation=lambda _: (0, 0),
            CGEventCreateKeyboardEvent=lambda _, key, down: {"key": key, "down": down},
            CGEventCreateMouseEvent=lambda _, kind, position, button: {
                "mouse": kind,
                "position": position,
                "flags": 123,
            },
            CGEventSetFlags=lambda event, flags: event.update(flags=flags),
            CGEventPost=lambda _, event: events.append(event),
            CGEventSourceButtonState=button_state or Mock(return_value=False),
        )

    def test_macos_releases_at_a_corner_and_waits_between_mouse_events(self):
        events = []
        quartz = self.macos_backend(events)
        services = SimpleNamespace(AXIsProcessTrusted=Mock(return_value=True))
        with (
            patch.dict(sys.modules, Quartz=quartz),
            patch.object(ctypes, "CDLL", return_value=services),
            patch.object(release.time, "sleep", side_effect=lambda delay: events.append({"wait": delay})),
        ):
            release.release_macos()
        self.assertEqual(len(events), 134)
        self.assertTrue(all(event["down"] is False for event in events if "key" in event))
        self.assertTrue(all(event["flags"] == 0 for event in events if "key" in event))
        self.assertTrue(all(event["flags"] == 123 for event in events if "mouse" in event))
        self.assertEqual([event["position"] for event in events if "mouse" in event], [(0, 0)] * 3)
        self.assertEqual([event["wait"] for event in events[-6::2]], [0.01] * 3)
        self.assertEqual([event["mouse"] for event in events[-5::2]], [1, 2, 3])
        self.assertEqual([call.args[1] for call in quartz.CGEventSourceButtonState.call_args_list], [0, 2, 1])

    def test_macos_waits_for_the_desktop_to_observe_mouse_releases(self):
        events = []
        states = Mock(side_effect=[True, False, False, False, False, False])
        quartz = self.macos_backend(events, states)
        services = SimpleNamespace(AXIsProcessTrusted=Mock(return_value=True))
        with (
            patch.dict(sys.modules, Quartz=quartz),
            patch.object(ctypes, "CDLL", return_value=services),
            patch.object(release.time, "sleep") as sleep,
        ):
            release.release_macos()
        self.assertEqual(states.call_count, 6)
        self.assertEqual(sleep.call_count, 4)

    def test_macos_reports_when_a_mouse_release_was_not_observed(self):
        events = []
        quartz = self.macos_backend(events, lambda _, button: button == 0)
        services = SimpleNamespace(AXIsProcessTrusted=Mock(return_value=True))
        with (
            patch.dict(sys.modules, Quartz=quartz),
            patch.object(ctypes, "CDLL", return_value=services),
            patch.object(release.time, "sleep"),
            patch.object(release.time, "monotonic", side_effect=[0, 0.1, 0.31]),
            self.assertRaisesRegex(RuntimeError, "Mouse buttons remain held"),
        ):
            release.release_macos()
        self.assertEqual(len(events), 131)

    def test_x11_flushes_releases_and_closes_the_display(self):
        events = []
        connection = SimpleNamespace(sync=Mock(), close=Mock())
        xlib = SimpleNamespace(
            X=SimpleNamespace(KeyRelease=3, ButtonRelease=5), display=SimpleNamespace(Display=lambda: connection)
        )
        xtest = SimpleNamespace(fake_input=lambda _, kind, detail: events.append((kind, detail)))
        with patch.dict(sys.modules, {"Xlib": xlib, "Xlib.ext.xtest": xtest}):
            release.release_x11()
        self.assertEqual(events[-3:], [(5, 1), (5, 2), (5, 3)])
        self.assertTrue(all(kind == 3 for kind, _ in events[:-3]))
        connection.sync.assert_called_once()
        connection.close.assert_called_once()

    def test_releases_keys_and_all_buttons_without_other_operations(self):
        events = []
        release.release_inputs(
            ["shift", "a", "shift"],
            lambda key: events.append(("key_up", key)),
            lambda button: events.append(("mouse_up", button)),
        )
        self.assertEqual(
            events, [("key_up", "shift"), ("key_up", "a"), ("mouse_up", 1), ("mouse_up", 2), ("mouse_up", 3)]
        )

    def test_attempts_remaining_releases_after_an_error(self):
        buttons = []

        def fail(_key):
            raise RuntimeError("permission denied")

        with self.assertRaisesRegex(RuntimeError, "permission denied"):
            release.release_inputs([1, 2], fail, buttons.append)
        self.assertEqual(buttons, [1, 2, 3])

    def test_windows_uses_only_native_up_events_including_modifiers(self):
        events = []

        class SendInput:
            def __call__(self, count, pointer, size):
                event = pointer._obj
                if event.type == 1:
                    events.append(("key", event.payload.keyboard.vk, event.payload.keyboard.flags))
                else:
                    events.append(("mouse", event.payload.mouse.flags))
                return count

        fake = SimpleNamespace(user32=SimpleNamespace(SendInput=SendInput()))
        with patch.object(ctypes, "windll", fake, create=True):
            release.release_windows()
        keys = [event for event in events if event[0] == "key"]
        self.assertTrue(all(event[2] & 2 for event in keys))
        for modifier in (0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5):
            self.assertTrue(any(event[1] == modifier for event in keys))
        self.assertEqual(
            [event for event in events if event[0] == "mouse"], [("mouse", 4), ("mouse", 64), ("mouse", 16)]
        )
