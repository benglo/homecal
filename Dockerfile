# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Family Calendar — multi-stage image.
# Build frontend + backend, compile better-sqlite3 for THIS image's arch,
# then ship a lean runtime. Build on/for the server's platform (spec gotcha):
#   docker compose build            (on the server)
#   docker buildx --platform linux/arm64 ...   (if cross-building for a Pi-arch server)
# ---------------------------------------------------------------------------

# ---- Stage 1: build (has toolchain to compile native modules) -------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Toolchain for better-sqlite3's native build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install deps first (cache-friendly). Copy only manifests.
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# npm ci compiles better-sqlite3 for this (the server's) architecture.
RUN npm install

# Build both workspaces.
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build

# Drop dev dependencies but keep the compiled native module (prod dep).
RUN npm prune --omit=dev

# ---- Stage 2: runtime (no toolchain) --------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/frontend/dist

# Pruned node_modules (incl. compiled better-sqlite3) + built output.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist

# Data dir is a bind-mount at runtime; create the mountpoint.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

# Healthcheck hits the API (also exercises SQLite integrity_check).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/server.js"]
