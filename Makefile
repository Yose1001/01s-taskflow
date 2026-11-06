.PHONY: help db-up db-down migrate-up migrate-down run-backend run-frontend test test-backend test-frontend test-e2e load-test lint lint-backend lint-frontend fmt docker-build prod-up prod-down smoke-test

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

db-up: ## Start local Postgres (Docker)
	docker compose up -d db

db-down: ## Stop local Postgres
	docker compose down

run-backend: ## Run the Go API on :8080 (reads .env)
	@test -f .env || { echo "Missing .env: run 'cp .env.example .env' and set JWT_SECRET"; exit 1; }
	set -a && . ./.env && set +a && cd backend && go run ./cmd/api

migrate-up: ## Apply DB migrations (needs the 'migrate' CLI and .env)
	@test -f .env || { echo "Missing .env"; exit 1; }
	set -a && . ./.env && set +a && migrate -path backend/migrations -database "$$DATABASE_URL" up

migrate-down: ## Roll back the last DB migration
	@test -f .env || { echo "Missing .env"; exit 1; }
	set -a && . ./.env && set +a && migrate -path backend/migrations -database "$$DATABASE_URL" down 1

run-frontend: ## Run the React dev server on :5173
	cd frontend && pnpm dev

test: test-backend test-frontend ## Run all tests

test-backend: ## Go tests (uses the local DB from .env when present: run 'make db-up' and 'make migrate-up' first)
	@if [ -f .env ]; then set -a && . ./.env && set +a && cd backend && TEST_DATABASE_URL="$$DATABASE_URL" go test ./... -race -cover -count=1; else cd backend && go test ./... -race -cover -count=1; fi

test-frontend: ## Frontend tests
	cd frontend && pnpm test

test-e2e: ## End-to-end tests in a real browser (own database "taskflow_e2e"; needs 'make db-up' and e2e/ deps)
	cd e2e && pnpm test

load-test: ## Load test: a normal working day, 50 people (needs k6 and 'make db-up'; see docs/load-testing.md)
	loadtest/run.sh workflow

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## go vet (+ golangci-lint if installed)
	cd backend && go vet ./...
	@command -v golangci-lint >/dev/null && (cd backend && golangci-lint run) || echo "golangci-lint not installed, skipped"

lint-frontend: ## ESLint
	cd frontend && pnpm lint

fmt: ## Format code
	cd backend && gofmt -w .
	cd frontend && pnpm format

docker-build: ## Build the three container images (api, migrate, web) locally
	docker build --target run     -t ghcr.io/yose1001/taskflow-api:dev     backend
	docker build --target migrate -t ghcr.io/yose1001/taskflow-migrate:dev backend
	docker build --target run     -t ghcr.io/yose1001/taskflow-web:dev     frontend

prod-up: ## Run the whole system from containers on http://localhost:8088 (needs .env.prod; see docs/deployment.md)
	@test -f .env.prod || { echo "Missing .env.prod: run 'cp env.prod.example .env.prod' and fill in the secrets"; exit 1; }
	docker compose --env-file .env.prod -f docker-compose.prod.yml up --build -d

prod-down: ## Stop the containerised system (data is kept)
	docker compose --env-file .env.prod -f docker-compose.prod.yml down

smoke-test: ## Check a running system end to end (default http://127.0.0.1:8088)
	scripts/smoke-test.sh
