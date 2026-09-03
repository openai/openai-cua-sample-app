#!/bin/sh
set -eu
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$HOME" "$XDG_RUNTIME_DIR"
touch "$HOME/.Xauthority"
rm -f /tmp/browser-ready
Xvfb "$DISPLAY" -screen 0 1440x1000x24 -nolisten tcp -ac > /tmp/xvfb.log 2>&1 &
attempt=0
until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 50 ]; then cat /tmp/xvfb.log >&2; exit 1; fi
    sleep 0.1
done
openbox > /tmp/openbox.log 2>&1 &
node /app/desktop.mjs > /tmp/browser.log 2>&1 &
browser_pid=$!
attempt=0
until [ -f /tmp/browser-ready ]; do
    attempt=$((attempt + 1))
    if ! kill -0 "$browser_pid" 2>/dev/null || [ "$attempt" -ge 150 ]; then
        cat /tmp/browser.log >&2
        exit 1
    fi
    sleep 0.2
done
exec node /app/server.mjs python /opt/pyautogui/bin/python /app/worker.py
