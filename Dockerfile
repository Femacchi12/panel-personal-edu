FROM node:22-slim
WORKDIR /app
COPY backend/package.json ./package.json
RUN npm install --omit=dev
# Runtime only: server + control-gastos module (tests and the local e2e
# harness/CLI are excluded via .dockerignore; no dev endpoints ship).
COPY backend/ ./
ENV NODE_ENV=production
CMD ["node", "server.js"]
