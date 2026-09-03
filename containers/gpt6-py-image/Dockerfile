FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:02bbb2155cd7109e3e9c741941097ed1608cf8b6fa44ee2595896da2bdc1f471

USER root
RUN rm -f /etc/apt/sources.list.d/nodesource* \
    && sed -i 's/azure.archive.ubuntu.com/archive.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    python3-venv python3-tk scrot openbox x11-utils \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/pyautogui
COPY gpt6-py-image/requirements.txt /tmp/requirements.txt
RUN /opt/pyautogui/bin/pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt
WORKDIR /app
COPY shared/package.json shared/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY shared/ ./
COPY gpt6-py-image/worker.py gpt6-py-image/start.sh ./
USER pwuser
ENV HOME=/tmp/cua-home DISPLAY=:99 XDG_SESSION_TYPE=x11 XDG_RUNTIME_DIR=/tmp/cua-xdg \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /tmp
EXPOSE 8000
HEALTHCHECK --interval=2s --timeout=2s --start-period=30s --retries=15 \
  CMD node /app/check.mjs health
CMD ["sh", "/app/start.sh"]
