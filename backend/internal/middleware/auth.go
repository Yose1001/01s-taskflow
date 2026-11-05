// Package middleware holds HTTP middleware.
package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/Yose1001/taskflow/backend/internal/httpx"
)

const maxTokenLen = 4096

type ctxKey struct{}

// Verifier validates an access token and returns the user id it belongs to.
type Verifier interface {
	Verify(token string) (string, error)
}

// Authenticate rejects requests without a valid "Authorization: Bearer <token>" header
// and stores the user id in the request context.
func Authenticate(v Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r.Header.Get("Authorization"))
			if !ok {
				unauthorized(w)
				return
			}
			userID, err := v.Verify(token)
			if err != nil {
				unauthorized(w)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, userID)))
		})
	}
}

// UserID returns the authenticated user id placed in ctx by Authenticate.
func UserID(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(ctxKey{}).(string)
	return id, ok && id != ""
}

func bearerToken(header string) (string, bool) {
	scheme, token, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || token == "" || len(token) > maxTokenLen {
		return "", false
	}
	return token, true
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="taskflow"`)
	httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "authentication required", nil)
}
