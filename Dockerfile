FROM node:22-slim
WORKDIR /app
COPY backend/package.json ./package.json
RUN npm install --omit=dev
COPY backend/server.js ./server.js
ENV NODE_ENV=production
CMD ["node", "server.js"]
