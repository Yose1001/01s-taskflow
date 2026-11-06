#!/usr/bin/env bash
# Gives the end-to-end tests a brand-new, empty database with all migrations applied.
#
# SAFETY: it DROPS the database it is pointed at, so it only accepts a name ending in "_e2e".
# Your development database ("taskflow") can never be touched by this script.
#
# Uses `psql` when it is installed (CI), otherwise the Postgres container from docker-compose (local).
set -euo pipefail

cd "$(dirname "$0")/../.."

DB_URL="${E2E_DATABASE_URL:-postgres://taskflow:taskflow_dev@localhost:5432/taskflow_e2e?sslmode=disable}"

without_query="${DB_URL%%\?*}"
db_name="${without_query##*/}"
server_url="${without_query%/*}/postgres?sslmode=disable"

if [[ ! "$db_name" =~ ^[a-z0-9_]+_e2e$ ]]; then
  echo "Refusing to run: the database name must end in _e2e (got '$db_name')." >&2
  exit 1
fi

if command -v psql >/dev/null 2>&1; then
  run_server() { psql "$server_url" -v ON_ERROR_STOP=1 -q -c "$1"; }
  run_file() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; }
else
  # No local psql: use the one inside the docker-compose database container.
  db_user="${POSTGRES_USER:-taskflow}"
  run_server() { docker compose exec -T db psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 -q -c "$1"; }
  run_file() { docker compose exec -T db psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -q <"$1" >/dev/null; }
fi

echo "e2e database: recreating '$db_name'"
run_server "DROP DATABASE IF EXISTS \"$db_name\" WITH (FORCE)"
run_server "CREATE DATABASE \"$db_name\""

for file in backend/migrations/*.up.sql; do
  run_file "$file"
done
echo "e2e database: ready"
