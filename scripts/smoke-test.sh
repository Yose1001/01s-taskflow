#!/usr/bin/env bash
# Quick "does the deployed system really work?" check, run against the web address of a running stack
# (docker-compose.prod.yml, or a real server). It only creates one throwaway user.
#
# Usage: scripts/smoke-test.sh [base-url]        (default http://127.0.0.1:8088)
#
# It checks what only a real deployment can break: the web server, the proxy to the API, the database
# and migrations, the security headers, and that people are told apart behind the proxy.
set -uo pipefail

BASE="${1:-${SMOKE_BASE_URL:-http://127.0.0.1:8088}}"
BASE="${BASE%/}"
failures=0

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { # check <description> <expected> <actual>
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi
}
contains() { # contains <description> <needle> <haystack>
  if [[ "$3" == *"$2"* ]]; then pass "$1"; else fail "$1 (missing '$2')"; fi
}

status() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

echo "smoke test: $BASE"

# Wait until the whole chain answers: web server -> API -> database (containers may still be starting).
for _ in $(seq 1 90); do
  [[ "$(status "$BASE/api/v1/ready")" == "200" ]] && break
  sleep 1
done

echo "web server"
check "/healthz answers" 200 "$(status "$BASE/healthz")"
page="$(curl -s --max-time 10 "$BASE/")"
contains "home page is the React app" '<div id="root">' "$page"
check "a deep link gets the app (client-side routing)" 200 "$(status "$BASE/projects/some-id")"
check "a missing file under /assets is a 404, not the app" 404 "$(status "$BASE/assets/does-not-exist.js")"

echo "security headers"
headers="$(curl -s -D - -o /dev/null --max-time 10 "$BASE/")"
contains "Content-Security-Policy" "content-security-policy:" "$(tr 'A-Z' 'a-z' <<<"$headers")"
contains "X-Content-Type-Options" "nosniff" "$headers"
contains "X-Frame-Options" "DENY" "$headers"
if grep -qi '^server: nginx/' <<<"$headers"; then fail "the server hides its version number"; else pass "the server hides its version number"; fi

echo "API through the proxy"
check "/api/v1/health" 200 "$(status "$BASE/api/v1/health")"
check "/api/v1/ready (database reachable, migrations applied)" 200 "$(status "$BASE/api/v1/ready")"
check "a protected route without a token is refused" 401 "$(status "$BASE/api/v1/projects")"

echo "a real person can sign up and sign in"
email="smoke-$(date +%s)-$RANDOM@smoke.test"
password="smoke-$(date +%s%N)-test"
credentials='"email":"'"$email"'","password":"'"$password"'"'
check "register" 201 "$(status -X POST -H 'Content-Type: application/json' -d "{$credentials,\"displayName\":\"Smoke\"}" "$BASE/api/v1/auth/register")"
login="$(curl -s -D - --max-time 10 -X POST -H 'Content-Type: application/json' -d "{$credentials}" "$BASE/api/v1/auth/login")"
token="$(sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p' <<<"$login")"
if [[ -n "$token" ]]; then pass "login returns a token"; else fail "login returns a token (got: $login)"; fi
check "the token opens a protected route" 200 "$(status -H "Authorization: Bearer $token" "$BASE/api/v1/projects")"

echo "staying signed in (refresh cookie)"
set_cookie="$(grep -i '^set-cookie: taskflow_refresh=' <<<"$login" | tr -d '\r')"
contains "login sets the refresh cookie as HttpOnly" "HttpOnly" "$set_cookie"
contains "... and SameSite=Strict" "SameSite=Strict" "$set_cookie"
contains "... only for /api/v1/auth" "Path=/api/v1/auth" "$set_cookie"
refresh_token="$(sed -n 's/^[Ss]et-[Cc]ookie: taskflow_refresh=\([^;]*\).*/\1/p' <<<"$set_cookie")"
check "the cookie gets a new access token" 200 "$(status -X POST -H "Cookie: taskflow_refresh=$refresh_token" "$BASE/api/v1/auth/refresh")"
check "logging out" 204 "$(status -X POST -H "Cookie: taskflow_refresh=$refresh_token" "$BASE/api/v1/auth/logout")"
check "after logging out the cookie is useless" 401 "$(status -X POST -H "Cookie: taskflow_refresh=$refresh_token" "$BASE/api/v1/auth/refresh")"

echo "sign-in limit"
# A caller can invent X-Forwarded-For values. The proxy appends the real address, so the API must
# still count all these attempts as one person and stop them. (Needs the default limit of 10 a minute.)
# The count restarts every minute, and a restart can fall in the middle of this loop. 25 attempts is more
# than two full allowances, so one side of a restart always goes over the limit.
limited=0
for i in $(seq 1 25); do
  code="$(status -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: 203.0.113.$i" \
    -d '{"email":"nobody@smoke.test","password":"wrong-password-123"}' "$BASE/api/v1/auth/login")"
  [[ "$code" == "429" ]] && limited=1
done
check "invented X-Forwarded-For values do not escape the limit" 1 "$limited"

echo
if ((failures > 0)); then
  echo "smoke test FAILED: $failures check(s)"
  exit 1
fi
echo "smoke test passed"
