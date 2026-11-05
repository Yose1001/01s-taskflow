// Package router wires HTTP routes to handlers.
package router

import (
	"context"
	"net/http"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/handler"
	"github.com/Yose1001/taskflow/backend/internal/httpx"
)

// Pinger reports whether a dependency (the database) is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Middleware wraps a handler.
type Middleware func(http.Handler) http.Handler

// Deps are everything the router needs. Nil optional fields disable that feature (used in tests).
type Deps struct {
	DB   Pinger
	Auth *handler.Auth

	// Authenticate protects routes that need a logged-in user.
	Authenticate Middleware
	// LoginLimit and RegisterLimit throttle credential endpoints per client. Optional.
	LoginLimit    Middleware
	RegisterLimit Middleware
}

// New returns the root HTTP handler for the API.
func New(d Deps) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", health)
	mux.HandleFunc("GET /api/v1/ready", ready(d.DB))

	if d.Auth != nil {
		mux.Handle("POST /api/v1/auth/register", wrap(d.RegisterLimit, http.HandlerFunc(d.Auth.Register)))
		mux.Handle("POST /api/v1/auth/login", wrap(d.LoginLimit, http.HandlerFunc(d.Auth.Login)))
		if d.Authenticate != nil {
			mux.Handle("GET /api/v1/me", d.Authenticate(http.HandlerFunc(d.Auth.Me)))
			mux.Handle("PATCH /api/v1/me", d.Authenticate(http.HandlerFunc(d.Auth.UpdateMe)))
		}
	}
	return mux
}

func wrap(m Middleware, h http.Handler) http.Handler {
	if m == nil {
		return h
	}
	return m(h)
}

// health is a liveness probe: it never touches dependencies.
func health(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ready is a readiness probe: it returns 503 when the database is unreachable.
func ready(db Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if db == nil {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			// Do not leak connection details to the client.
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
