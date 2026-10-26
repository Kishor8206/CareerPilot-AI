# ==========================================================
# CareerPilot AI - Node.js API gateway
# Build from the repository root:
#   docker build -f docker/backend.Dockerfile -t careerpilot-backend .
# ==========================================================

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build

WORKDIR /app

# Copy only the manifests first so the dependency layer is cached and does not
# rebuild on every source change.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY database/package.json ./database/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# `--ignore-scripts` skips the workspace `prepare` builds, which cannot run
# before the sources are copied.
RUN npm ci --ignore-scripts

COPY shared ./shared
COPY database ./database
COPY backend ./backend

RUN npm run build --workspace shared \
 && npm run build --workspace database \
 && npm run build --workspace backend

# Drop dev dependencies from the tree that gets copied into the runtime image.
RUN npm prune --omit=dev --workspace backend --workspace shared --workspace database

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime

# dumb-init reaps zombies and forwards signals, so SIGTERM reaches Node and the
# graceful-shutdown handler actually runs.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

# Run as an unprivileged user. The node image already provides uid/gid 1000.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/shared/dist ./shared/dist
COPY --from=build --chown=node:node /app/shared/package.json ./shared/
COPY --from=build --chown=node:node /app/database/dist ./database/dist
COPY --from=build --chown=node:node /app/database/package.json ./database/
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/package.json ./backend/
COPY --from=build --chown=node:node /app/package.json ./

# Writable storage for locally-stored resumes when STORAGE_PROVIDER=local.
# Mount a volume here in production, or use S3.
RUN mkdir -p /app/backend/storage && chown -R node:node /app/backend/storage

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5000/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "backend/dist/server.js"]
