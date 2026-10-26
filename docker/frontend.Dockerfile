# ==========================================================
# CareerPilot AI - React frontend, served by nginx
# Build from the repository root:
#   docker build -f docker/frontend.Dockerfile -t careerpilot-frontend .
# ==========================================================

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY database/package.json ./database/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --ignore-scripts

COPY shared ./shared
COPY frontend ./frontend

# Vite inlines VITE_* variables at build time, so the API URL is a build arg
# rather than a runtime environment variable.
ARG VITE_API_URL=/api/v1
ARG VITE_SOCKET_URL=
ARG VITE_DEMO_MODE=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL \
    VITE_DEMO_MODE=$VITE_DEMO_MODE

RUN npm run build --workspace shared \
 && npm run build --workspace frontend

# ---------- Stage 2: runtime ----------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
