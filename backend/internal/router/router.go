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
	DB       Pinger
	Auth     *handler.Auth
	Projects *handler.Projects
	Tasks    *handler.Tasks
	Calendar *handler.Calendar

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
		// These two use the refresh cookie instead of an access token.
		mux.HandleFunc("POST /api/v1/auth/refresh", d.Auth.Refresh)
		mux.HandleFunc("POST /api/v1/auth/logout", d.Auth.Logout)
		if d.Authenticate != nil {
			mux.Handle("GET /api/v1/me", d.Authenticate(http.HandlerFunc(d.Auth.Me)))
			mux.Handle("PATCH /api/v1/me", d.Authenticate(http.HandlerFunc(d.Auth.UpdateMe)))
		}
	}

	// Every project route requires a logged-in user. Without Authenticate they are not registered at all.
	if d.Projects != nil && d.Authenticate != nil {
		p, authn := d.Projects, d.Authenticate
		mux.Handle("POST /api/v1/projects", authn(http.HandlerFunc(p.Create)))
		mux.Handle("GET /api/v1/projects", authn(http.HandlerFunc(p.List)))
		mux.Handle("GET /api/v1/projects/{projectId}", authn(http.HandlerFunc(p.Get)))
		mux.Handle("PATCH /api/v1/projects/{projectId}", authn(http.HandlerFunc(p.Update)))
		mux.Handle("DELETE /api/v1/projects/{projectId}", authn(http.HandlerFunc(p.Delete)))
		mux.Handle("POST /api/v1/projects/{projectId}/restore", authn(http.HandlerFunc(p.Restore)))
		mux.Handle("GET /api/v1/projects/{projectId}/members", authn(http.HandlerFunc(p.ListMembers)))
		mux.Handle("POST /api/v1/projects/{projectId}/members", authn(http.HandlerFunc(p.AddMember)))
		mux.Handle("DELETE /api/v1/projects/{projectId}/members/{userId}", authn(http.HandlerFunc(p.RemoveMember)))
	}

	// Task routes also require a logged-in user.
	if d.Tasks != nil && d.Authenticate != nil {
		t, authn := d.Tasks, d.Authenticate
		mux.Handle("GET /api/v1/projects/{projectId}/tasks", authn(http.HandlerFunc(t.List)))
		mux.Handle("POST /api/v1/projects/{projectId}/tasks", authn(http.HandlerFunc(t.Create)))
		mux.Handle("GET /api/v1/tasks/{taskId}", authn(http.HandlerFunc(t.Get)))
		mux.Handle("PATCH /api/v1/tasks/{taskId}", authn(http.HandlerFunc(t.Update)))
		mux.Handle("DELETE /api/v1/tasks/{taskId}", authn(http.HandlerFunc(t.Delete)))
		mux.Handle("POST /api/v1/tasks/{taskId}/restore", authn(http.HandlerFunc(t.Restore)))
		mux.Handle("POST /api/v1/tasks/{taskId}/move", authn(http.HandlerFunc(t.Move)))
		mux.Handle("POST /api/v1/tasks/{taskId}/subtasks", authn(http.HandlerFunc(t.AddSubtask)))
		mux.Handle("PATCH /api/v1/tasks/{taskId}/subtasks/{subtaskId}", authn(http.HandlerFunc(t.UpdateSubtask)))
		mux.Handle("DELETE /api/v1/tasks/{taskId}/subtasks/{subtaskId}", authn(http.HandlerFunc(t.DeleteSubtask)))
	}
	// The calendar, important days and reminders: each person's own view, so login is required.
	if d.Calendar != nil && d.Authenticate != nil {
		c, authn := d.Calendar, d.Authenticate
		mux.Handle("GET /api/v1/calendar", authn(http.HandlerFunc(c.Range)))
		mux.Handle("POST /api/v1/events", authn(http.HandlerFunc(c.CreateEvent)))
		mux.Handle("PATCH /api/v1/events/{eventId}", authn(http.HandlerFunc(c.UpdateEvent)))
		mux.Handle("DELETE /api/v1/events/{eventId}", authn(http.HandlerFunc(c.DeleteEvent)))
		mux.Handle("GET /api/v1/notifications", authn(http.HandlerFunc(c.Notifications)))
		mux.Handle("POST /api/v1/notifications/read", authn(http.HandlerFunc(c.MarkRead)))
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
