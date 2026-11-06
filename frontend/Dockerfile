# syntax=docker/dockerfile:1

# ---- build: turn the React app into plain static files --------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
# corepack installs the exact pnpm version named in package.json ("packageManager").
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Install dependencies first so this layer is cached until the lock file changes.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- run: nginx serves the files and forwards /api to the Go server -------------------------
# The "unprivileged" nginx runs as a normal user (not root) and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS run
# Pick up security fixes for operating-system packages published since the base image was built.
USER root
RUN apk upgrade --no-cache
USER 101
# Files in templates/ get ${VARIABLES} filled from the environment when the container starts.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Where /api requests are forwarded: the Go API (the service name "api" in docker-compose.prod.yml).
ENV API_UPSTREAM=api:8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
