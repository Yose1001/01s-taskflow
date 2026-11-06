.PHONY: help db-up db-down migrate-up migrate-down run-backend run-frontend test test-backend test-frontend test-e2e lint lint-backend lint-frontend fmt

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

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## go vet (+ golangci-lint if installed)
	cd backend && go vet ./...
	@command -v golangci-lint >/dev/null && (cd backend && golangci-lint run) || echo "golangci-lint not installed, skipped"

lint-frontend: ## ESLint
	cd frontend && pnpm lint

fmt: ## Format code
	cd backend && gofmt -w .
	cd frontend && pnpm format
