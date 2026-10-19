# Single container: API + realtime collaboration + built frontend on one port.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server/migrations ./server/migrations
# Uploaded files live here — mount a persistent volume at /data.
ENV UPLOAD_DIR=/data/uploads
ENV BACKUP_DIR=/data/backups
EXPOSE 3000
CMD ["node", "dist/server.js"]
