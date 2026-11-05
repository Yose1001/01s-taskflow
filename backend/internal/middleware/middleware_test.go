package middleware

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeVerifier struct{}

func (fakeVerifier) Verify(token string) (string, error) {
	if token == "good" {
		return "user-1", nil
	}
	return "", errors.New("bad token")
}

func okHandler(gotUser *string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id, ok := UserID(r.Context()); ok {
			*gotUser = id
		}
		w.WriteHeader(http.StatusOK)
	})
}

func TestAuthenticate(t *testing.T) {
	tests := []struct {
		name, header string
		wantStatus   int
		wantUser     string
	}{
		{"no header", "", 401, ""},
		{"wrong scheme", "Basic Zm9vOmJhcg==", 401, ""},
		{"bearer without token", "Bearer", 401, ""},
		{"bearer empty token", "Bearer ", 401, ""},
		{"bad token", "Bearer nope", 401, ""},
		{"oversized token", "Bearer " + string(make([]byte, 5000)), 401, ""},
		{"good token", "Bearer good", 200, "user-1"},
		{"scheme is case-insensitive", "bearer good", 200, "user-1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			h := Authenticate(fakeVerifier{})(okHandler(&got))
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if got != tc.wantUser {
				t.Errorf("user in context = %q, want %q", got, tc.wantUser)
			}
			if tc.wantStatus == 401 && rec.Header().Get("WWW-Authenticate") == "" {
				t.Error("401 should include WWW-Authenticate")
			}
		})
	}
}

func TestUserIDMissing(t *testing.T) {
	if _, ok := UserID(httptest.NewRequest(http.MethodGet, "/", nil).Context()); ok {
		t.Error("UserID should report false when unauthenticated")
	}
}

func TestRateLimiter(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := NewRateLimiter(3, time.Minute)
	l.now = func() time.Time { return now }

	var user string
	h := l.Middleware(okHandler(&user))
	call := func(remote string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		req.RemoteAddr = remote
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	for i := 1; i <= 3; i++ {
		if rec := call("10.0.0.1:1111"); rec.Code != 200 {
			t.Fatalf("request %d: status = %d, want 200", i, rec.Code)
		}
	}
	rec := call("10.0.0.1:2222") // same IP, different port
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request: status = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 should include Retry-After")
	}
	if rec := call("10.0.0.2:1111"); rec.Code != 200 {
		t.Errorf("other client should not be limited, got %d", rec.Code)
	}

	now = now.Add(time.Minute + time.Second) // window resets
	if rec := call("10.0.0.1:3333"); rec.Code != 200 {
		t.Errorf("after window: status = %d, want 200", rec.Code)
	}
}
