#!/usr/bin/env bash
# Runs one load test against its own copy of the system:
#   fresh database "taskflow_load"  ->  the real API (a compiled binary, port 8082)  ->  k6
# Your development servers and data are never touched.
#
# Usage:   loadtest/run.sh workflow          (a normal working day, 50 people)
#          loadtest/run.sh stress            (steps of rising load, to find the limit)
#          loadtest/run.sh login-burst       (password guessing, with the strict real limits)
# Extra k6 settings: USERS=100 HOLD=5m loadtest/run.sh workflow     (see the top of each script)
set -euo pipefail

name="${1:-}"
if [[ -z "$name" || ! -f "$(dirname "$0")/$name.js" ]]; then
  echo "Usage: $0 <workflow|stress|login-burst>" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
command -v k6 >/dev/null || { echo "k6 is not installed (https://k6.io/docs/get-started/installation/)" >&2; exit 1; }
command -v go >/dev/null || { echo "Go is not installed" >&2; exit 1; }

PORT=8082
DB_URL="${LOAD_DATABASE_URL:-postgres://taskflow:taskflow_dev@localhost:5432/taskflow_load?sslmode=disable}"
bin="$(mktemp -d)/taskflow-api"
out="$root/loadtest/results"
mkdir -p "$out"
stamp="$(date +%Y%m%d-%H%M%S)"

echo "== building the API"
(cd backend && go build -o "$bin" ./cmd/api)

echo "== fresh database"
bash scripts/prepare-test-db.sh "$DB_URL"

# Every virtual user comes from one address, so the sign-in/sign-up limits are lifted for the load
# runs. The login-burst test is the one that needs the real, strict limits.
if [[ "$name" == "login-burst" ]]; then
  limits=(LOGIN_RATE_LIMIT_PER_MINUTE=10 REGISTER_RATE_LIMIT_PER_MINUTE=5)
else
  limits=(LOGIN_RATE_LIMIT_PER_MINUTE=1000000 REGISTER_RATE_LIMIT_PER_MINUTE=1000000)
fi

echo "== starting the API on :$PORT"
env PORT=$PORT DATABASE_URL="$DB_URL" JWT_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  "${limits[@]}" "$bin" >"$out/api-$name-$stamp.log" 2>&1 &
api_pid=$!
cleanup() { kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; rm -f "$bin"; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -fs "http://localhost:$PORT/api/v1/ready" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fs "http://localhost:$PORT/api/v1/ready" >/dev/null || { echo "API did not become ready; see $out/api-$name-$stamp.log" >&2; exit 1; }

# Sample the API's memory and CPU every 2 seconds while the test runs.
samples="$out/resources-$name-$stamp.csv"
echo "seconds,rss_mb,cpu_percent" >"$samples"
(
  start=$(date +%s)
  while kill -0 "$api_pid" 2>/dev/null; do
    read -r rss cpu < <(ps -o rss=,pcpu= -p "$api_pid" 2>/dev/null || echo "0 0")
    echo "$(( $(date +%s) - start )),$(( ${rss:-0} / 1024 )),${cpu:-0}" >>"$samples"
    sleep 2
  done
) &
sampler_pid=$!
trap 'kill "$sampler_pid" 2>/dev/null || true; cleanup' EXIT

echo "== running k6: $name"
set +e
BASE_URL="http://localhost:$PORT/api/v1" k6 run --summary-export "$out/summary-$name-$stamp.json" "loadtest/$name.js"
k6_status=$?
set -e

kill "$sampler_pid" 2>/dev/null || true
if [[ -s "$samples" ]]; then
  awk -F, 'NR>1 { if ($2>m) m=$2; if ($3>c) c=$3; n++ } END { printf "== API resources while testing: peak memory %d MB, peak CPU %.0f%% (of one core), %d samples\n", m, c, n }' "$samples"
fi
echo "== results saved in loadtest/results/ (summary-$name-$stamp.json)"
exit $k6_status
