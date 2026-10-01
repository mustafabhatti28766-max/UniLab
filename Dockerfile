# ---- Build the web app ----
FROM node:22-alpine AS web
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Runtime: API + built web app on one port ----
FROM node:22-alpine
# tzdata lets the TZ variable set the university's local time (booking times are local).
RUN apk add --no-cache tzdata
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/client/dist /app/client/dist
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
