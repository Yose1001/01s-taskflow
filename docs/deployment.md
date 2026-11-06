# Deployment

TaskFlow ships as three container images. This page explains what they are, how to run the whole
system from them, what settings exist, and how to update or roll back.

> Scope: this covers **building and running the images** (step 7). Choosing a hosting provider,
> HTTPS and a public address come in step 8 (staging / production).

## The images

| Image | Built from | What it is |
| --- | --- | --- |
| `taskflow-api` | `backend/Dockerfile`, target `run` | The Go API. A single static program on a minimal Alpine base, ~30 MB, runs as a non-root user (uid 10001). |
| `taskflow-migrate` | `backend/Dockerfile`, target `migrate` | A one-shot job that brings the database schema up to date, then exits. It holds the SQL files from `backend/migrations`. |
| `taskflow-web` | `frontend/Dockerfile`, target `run` | nginx (non-root, port 8080) serving the built React app and forwarding `/api` to the API. |

Published to GitHub's container registry after every merge to `main`:
`ghcr.io/yose1001/taskflow-{api,migrate,web}`, tagged `sha-<commit>` (exact version) and `latest`.
Deploy a `sha-…` tag, not `latest`: it tells you exactly what is running and makes rolling back trivial.

## Run everything locally

```bash
cp env.prod.example .env.prod
# fill in POSTGRES_PASSWORD and JWT_SECRET (the comments in the file show how to generate them)
docker compose --env-file .env.prod -f docker-compose.prod.yml up --build
```

Open <http://localhost:8088>. Check that it really works with:

```bash
scripts/smoke-test.sh            # or: make smoke-test
```

The same check runs in CI against images built from the pull request.

How the pieces connect:

```
browser ──► web (nginx, :8088 → 8080) ──/api──► api (:8080, private) ──► db (private)
                                     └─ everything else: the React app
```

* Only `web` is reachable from outside. The API and database have no published ports.
* The browser talks to one address only, so no CORS settings are needed.
* On start, `migrate` runs first and `api` waits for it to finish successfully. Running it twice is
  harmless: already-applied steps are skipped, and a database lock stops two copies colliding.

## Settings

All settings are environment variables. Secrets live only in your `.env.prod` (git-ignored) or your
hosting provider's secret store. They are never baked into an image and never committed.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | yes | – | Database password. Use hex (`openssl rand -hex 24`) so it is safe inside the database URL. |
| `JWT_SECRET` | yes | – | Signs login tokens. At least 32 characters (`openssl rand -hex 32`). Changing it logs everyone out. |
| `POSTGRES_USER` / `POSTGRES_DB` | no | `taskflow` | Database user and name. |
| `JWT_TTL_MINUTES` | no | `60` | How long an access token lasts (the app renews it quietly). |
| `SESSION_TTL_DAYS` | no | `30` | How long someone stays signed in without using the app (1-365). |
| `TRASH_RETENTION_DAYS` | no | `30` | Days before trashed items are deleted for good. |
| `LOGIN_RATE_LIMIT_PER_MINUTE` / `REGISTER_RATE_LIMIT_PER_MINUTE` | no | `10` / `5` | Sign-in and sign-up attempts per person per minute. Keep the defaults. |
| `TRUSTED_PROXIES` | no | the `web` container (in the compose file) | See below. |
| `IMAGE_TAG` | no | `dev` | Which image version to run. |
| `WEB_BIND` / `WEB_PORT` | no | `127.0.0.1` / `8088` | Where the web port is opened on the host. |

### Why `TRUSTED_PROXIES` matters

The sign-in limit counts attempts **per person**, identified by network address. Behind nginx every
request arrives from nginx's address, so without help the whole world would share one allowance (one
person guessing passwords would lock everybody out).

nginx therefore adds the real address to the `X-Forwarded-For` header, and the API believes that
header **only** when the request comes from an address listed in `TRUSTED_PROXIES`. Anyone else can
send any header they like, so it is ignored for them. The API reads the header from the right and
takes the first address that is not itself a trusted proxy, so a visitor who invents extra values
gains nothing (the smoke test checks this).

* In `docker-compose.prod.yml` the `web` container has a fixed address (`172.31.250.10`) and that one
  address is the default. **Trust exactly your proxy, not a whole private network.** A first version
  trusted all private ranges, and the smoke test caught the flaw: to Docker every visitor looks like
  the host's gateway address (`172.31.250.1`), which is inside a private range, so it was skipped as
  "a proxy" and a visitor could invent the header to dodge the limit.
* The Go program itself defaults to trusting **nobody** (empty list).
* If you put another proxy or load balancer in front of `web`, add its address too, and make `web`
  read the client address through it (nginx `set_real_ip_from`); step 8 covers this for the chosen host.
* Never set it to `0.0.0.0/0` or to a network that untrusted machines can reach the API from.

## Security notes

* All three containers run as a non-root user. `api` and `web` run with a read-only filesystem, all
  Linux capabilities dropped and `no-new-privileges`.
* `web` sends a strict Content-Security-Policy (no inline scripts), `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, a referrer policy and a permissions policy.
* **HTTPS and HSTS are not handled here.** Put a TLS-terminating proxy or your provider's load
  balancer in front, and let it add `Strict-Transport-Security`. Do not expose the plain HTTP port to
  the internet; that is why `WEB_BIND` defaults to `127.0.0.1`.
* Staying signed in uses a random refresh token in a cookie that is `HttpOnly` (page scripts cannot
  read it), `Secure` (HTTPS only; browsers also allow it on `http://localhost`), `SameSite=Strict`
  (other sites cannot make the browser send it) and limited to `/api/v1/auth`. The database stores
  only its SHA-256 hash. Each use replaces it; reusing an old one ends that session (possible theft).
  Logging out ends the session on the server. The access token itself stays in memory only.
* CI scans every image with Trivy and fails on HIGH / CRITICAL vulnerabilities that have a fix.
* The database is a container with a volume here, which is fine for trying things out. For real data
  use a managed PostgreSQL with backups and put its URL in `DATABASE_URL` (step 8).

## Updating and rolling back

```bash
# update to a specific build
IMAGE_TAG=sha-1a2b3c4 docker compose --env-file .env.prod -f docker-compose.prod.yml pull
IMAGE_TAG=sha-1a2b3c4 docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

Roll back by running the same commands with the previous tag.

**Database changes need care.** `migrate` only moves the schema *forward* when it starts. Rolling back
the **images** is easy; rolling back the **schema** is a separate, deliberate step
(`migrate … down 1`) and can lose data. Because of that, write migrations so that the previous
version of the app still works with the new schema (add columns before using them; remove them one
release later). Take a database backup before any release that contains a migration.

## Building images by hand

```bash
docker build --target run     -t taskflow-api:dev     backend
docker build --target migrate -t taskflow-migrate:dev backend
docker build --target run     -t taskflow-web:dev     frontend
```
