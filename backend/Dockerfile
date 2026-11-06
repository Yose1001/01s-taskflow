# syntax=docker/dockerfile:1

# ---- build: compile a static Go binary ------------------------------------------------------
FROM golang:1.27-alpine AS build
WORKDIR /src

# Download dependencies first so this layer is cached until go.mod / go.sum change.
COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
# CGO off = a fully static binary; -trimpath and -s -w drop local paths and debug info (smaller image).
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# ---- migrate: applies the SQL files in migrations/ (one-shot job, not the web server) -------
# golang-migrate takes a database lock, so two copies started together never apply the same step twice.
FROM migrate/migrate:v4.19.0 AS migrate
COPY migrations /migrations
ENTRYPOINT ["migrate", "-path", "/migrations"]

# ---- run: the smallest image that can run the API --------------------------------------------
FROM alpine:3.22 AS run
# ca-certificates: for TLS to a managed database. tzdata: so TZ works if set.
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 10001 app \
 && adduser -S -u 10001 -G app -H -h /nonexistent -s /sbin/nologin app
COPY --from=build /out/api /usr/local/bin/api
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
# /health never touches the database: it only says "the process is alive".
# (Whether the database is reachable is /ready, which the deployment checks separately.)
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/v1/health" || exit 1
ENTRYPOINT ["/usr/local/bin/api"]
