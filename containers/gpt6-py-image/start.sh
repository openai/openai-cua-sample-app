#!/bin/sh
set -eu
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$HOME" "$XDG_RUNTIME_DIR"
touch "$HOME/.Xauthority"
Xvfb "$DISPLAY" -screen 0 1440x1000x24 -nolisten tcp -ac > /tmp/xvfb.log 2>&1 &
attempt=0
until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 50 ]; then cat /tmp/xvfb.log >&2; exit 1; fi
    sleep 0.1
done
openbox > /tmp/openbox.log 2>&1 &
set -- /ms-playwright/chromium-*/chrome-linux64/chrome
exec "$1" --user-data-dir=/tmp/chromium-profile \
    --no-first-run --no-default-browser-check --disable-extensions \
    --disable-background-networking --password-store=basic \
    --window-position=0,0 --window-size=1440,1000 \
    'data:text/html,<title>CUA desktop</title><h1>Desktop ready</h1>' \
    > /tmp/chromium.log 2>&1
