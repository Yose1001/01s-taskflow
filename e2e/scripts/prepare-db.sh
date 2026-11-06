#!/usr/bin/env bash
# Fresh database for the end-to-end tests ("taskflow_e2e"). The real work is in scripts/prepare-test-db.sh.
set -euo pipefail
exec bash "$(dirname "$0")/../../scripts/prepare-test-db.sh" \
  "${E2E_DATABASE_URL:-postgres://taskflow:taskflow_dev@localhost:5432/taskflow_e2e?sslmode=disable}"
