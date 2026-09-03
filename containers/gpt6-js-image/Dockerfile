FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:02bbb2155cd7109e3e9c741941097ed1608cf8b6fa44ee2595896da2bdc1f471

WORKDIR /app
COPY shared/package.json shared/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY shared/ ./
COPY gpt6-js-image/worker.mjs ./worker.mjs
USER pwuser
ENV HOME=/tmp/cua-home
WORKDIR /tmp
EXPOSE 8000
HEALTHCHECK --interval=2s --timeout=2s --start-period=30s --retries=15 \
  CMD node /app/check.mjs health
CMD ["node", "/app/server.mjs", "javascript", "node", "/app/worker.mjs"]
