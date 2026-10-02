# Stage 1: Build frontend + compile server
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

# Stage 2: Production runtime
FROM node:20-slim AS production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

EXPOSE 4000

ENV PORT=4000
ENV AMBIENTE=1
ENV SYNC_CRON="0 */2 * * *"

CMD ["node", "dist-server/index.js"]
