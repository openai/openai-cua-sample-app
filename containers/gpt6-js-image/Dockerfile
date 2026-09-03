FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:02bbb2155cd7109e3e9c741941097ed1608cf8b6fa44ee2595896da2bdc1f471

WORKDIR /app
COPY gpt6-js-image/package.json gpt6-js-image/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY gpt6-js-image/check.mjs ./check.mjs
USER pwuser
ENV HOME=/tmp/cua-home
WORKDIR /tmp
CMD ["node", "/app/check.mjs"]
