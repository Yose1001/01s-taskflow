package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/handler"
	"github.com/Yose1001/taskflow/backend/internal/middleware"
	"github.com/Yose1001/taskflow/backend/internal/service"
	"github.com/Yose1001/taskflow/backend/internal/testutil"
)

// clock is a settable time source for tests.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type sessionServer struct {
	h        http.Handler
	sessions *testutil.MemSessionStore
	users    *testutil.MemUserStore
	clock    *clock
}

func newSessionServer(t *testing.T, opts ...handler.AuthOption) sessionServer {
	t.Helper()
	users, sessions := testutil.NewMemUserStore(), testutil.NewMemSessionStore()
	c := &clock{t: time.Now()}
	svc, err := service.NewAuth(users, secret, time.Hour, service.WithBcryptCost(4),
		service.WithClock(c.now), service.WithSessions(sessions, 30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	h := New(Deps{Auth: handler.NewAuth(svc, opts...), Authenticate: middleware.Authenticate(svc)})
	return sessionServer{h: h, sessions: sessions, users: users, clock: c}
}

// post sends a request with an optional refresh cookie and returns the response and the cookie it set.
func post(t *testing.T, h http.Handler, path, cookie, body string) (resp, *http.Cookie) {
	t.Helper()
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: handler.RefreshCookieName, Value: cookie})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var set *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == handler.RefreshCookieName {
			set = c
		}
	}
	var parsed map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return resp{code: rec.Code, body: parsed, raw: rec.Body.String(), header: rec.Header()}, set
}

func (s sessionServer) login(t *testing.T) (string, *http.Cookie) {
	t.Helper()
	if r := do(t, s.h, "POST", "/api/v1/auth/register", "", regBody); r.code != 201 {
		t.Fatalf("register: %d %s", r.code, r.raw)
	}
	r, c := post(t, s.h, "/api/v1/auth/login", "", `{"email":"user@example.com","password":"correct horse battery"}`)
	if r.code != 200 || c == nil {
		t.Fatalf("login: %d %s cookie=%v", r.code, r.raw, c)
	}
	return r.body["accessToken"].(string), c
}

func TestLoginSetsAProtectedRefreshCookie(t *testing.T) {
	s := newSessionServer(t)
	_, c := s.login(t)
	r, other := post(t, s.h, "/api/v1/auth/register", "",
		`{"email":"second@example.com","password":"correct horse battery","displayName":"Two"}`)
	if r.code != 201 || other != nil {
		t.Errorf("register must not set a cookie (sign-in is a separate step): %d cookie=%v", r.code, other)
	}

	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode {
		t.Errorf("cookie flags: HttpOnly=%v Secure=%v SameSite=%v", c.HttpOnly, c.Secure, c.SameSite)
	}
	if c.Path != "/api/v1/auth" {
		t.Errorf("Path = %q, want /api/v1/auth (never sent to other endpoints)", c.Path)
	}
	if c.MaxAge != 30*24*3600 {
		t.Errorf("MaxAge = %d, want 30 days", c.MaxAge)
	}
	if len(c.Value) != 43 {
		t.Errorf("token length = %d, want 43 (256 random bits)", len(c.Value))
	}
	if s.sessions.Count() != 1 {
		t.Errorf("sessions = %d, want 1", s.sessions.Count())
	}
}

func TestSecureFlagCanBeTurnedOff(t *testing.T) {
	s := newSessionServer(t, handler.WithSecureCookie(false))
	_, c := s.login(t)
	if c.Secure {
		t.Error("Secure should be off")
	}
}

func TestRefreshGivesANewAccessTokenAndRotatesTheCookie(t *testing.T) {
	s := newSessionServer(t)
	_, c := s.login(t)

	r, next := post(t, s.h, "/api/v1/auth/refresh", c.Value, "")
	if r.code != 200 || r.body["tokenType"] != "Bearer" || r.body["expiresIn"] != float64(3600) {
		t.Fatalf("refresh: %d %s", r.code, r.raw)
	}
	if r.header.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", r.header.Get("Cache-Control"))
	}
	if next == nil || next.Value == c.Value || next.MaxAge <= 0 {
		t.Fatalf("expected a new cookie, got %v", next)
	}
	tok, _ := r.body["accessToken"].(string)
	if me := do(t, s.h, "GET", "/api/v1/me", tok, ""); me.code != 200 || me.body["email"] != "user@example.com" {
		t.Errorf("new access token does not work: %d %s", me.code, me.raw)
	}
	if strings.Contains(r.raw, next.Value) || strings.Contains(r.raw, c.Value) {
		t.Error("the refresh token must only travel in the cookie, never in the body")
	}

	// The new cookie works too.
	if r2, _ := post(t, s.h, "/api/v1/auth/refresh", next.Value, ""); r2.code != 200 {
		t.Errorf("second refresh: %d %s", r2.code, r2.raw)
	}
}

func TestTwoTabsRefreshingAtOnceBothStaySignedIn(t *testing.T) {
	s := newSessionServer(t)
	_, c := s.login(t)

	first, firstCookie := post(t, s.h, "/api/v1/auth/refresh", c.Value, "")
	second, secondCookie := post(t, s.h, "/api/v1/auth/refresh", c.Value, "") // same old token, a moment later
	if first.code != 200 || second.code != 200 {
		t.Fatalf("statuses %d, %d; want 200, 200", first.code, second.code)
	}
	if firstCookie == nil {
		t.Fatal("the first refresh must rotate the cookie")
	}
	if secondCookie != nil {
		t.Errorf("the second must not overwrite the browser's new cookie, got %v", secondCookie)
	}
}

func TestReplayingAnOldTokenEndsTheSession(t *testing.T) {
	s := newSessionServer(t)
	_, c := s.login(t)
	_, next := post(t, s.h, "/api/v1/auth/refresh", c.Value, "")

	s.clock.add(time.Minute) // past the grace period
	r, cleared := post(t, s.h, "/api/v1/auth/refresh", c.Value, "")
	if r.code != 401 || r.body["code"] != "unauthorized" {
		t.Fatalf("replay: %d %s", r.code, r.raw)
	}
	if cleared == nil || cleared.MaxAge >= 0 {
		t.Errorf("a refused cookie should be deleted, got %v", cleared)
	}
	// Possible theft: the legitimate newer token is cancelled too.
	if r2, _ := post(t, s.h, "/api/v1/auth/refresh", next.Value, ""); r2.code != 401 {
		t.Errorf("session should be ended, got %d", r2.code)
	}
	if s.sessions.Count() != 0 {
		t.Errorf("sessions = %d, want 0", s.sessions.Count())
	}
}

func TestRefreshRejectsBadCookies(t *testing.T) {
	s := newSessionServer(t)
	s.login(t)
	for name, cookie := range map[string]string{
		"none":     "",
		"garbage":  "not-a-real-token",
		"too long": strings.Repeat("a", 500),
	} {
		t.Run(name, func(t *testing.T) {
			if r, _ := post(t, s.h, "/api/v1/auth/refresh", cookie, ""); r.code != 401 {
				t.Errorf("status = %d, want 401", r.code)
			}
		})
	}
}

func TestSessionExpiresAfterItsLifetime(t *testing.T) {
	s := newSessionServer(t)
	_, c := s.login(t)
	s.clock.add(31 * 24 * time.Hour)
	if r, _ := post(t, s.h, "/api/v1/auth/refresh", c.Value, ""); r.code != 401 {
		t.Errorf("status = %d, want 401", r.code)
	}
}

func TestUsingTheSessionKeepsItAlive(t *testing.T) {
	s := newSessionServer(t)
	_, c := s.login(t)
	for range 3 { // 3 x 20 days: longer than 30 days in total, but never 30 days unused
		s.clock.add(20 * 24 * time.Hour)
		r, next := post(t, s.h, "/api/v1/auth/refresh", c.Value, "")
		if r.code != 200 || next == nil {
			t.Fatalf("refresh: %d %s", r.code, r.raw)
		}
		c = next
	}
}

func TestLogoutEndsTheSessionAndRemovesTheCookie(t *testing.T) {
	s := newSessionServer(t)
	_, c := s.login(t)

	r, cleared := post(t, s.h, "/api/v1/auth/logout", c.Value, "")
	if r.code != 204 {
		t.Fatalf("logout: %d %s", r.code, r.raw)
	}
	if cleared == nil || cleared.MaxAge >= 0 || cleared.Path != "/api/v1/auth" {
		t.Errorf("cookie not removed: %v", cleared)
	}
	if s.sessions.Count() != 0 {
		t.Errorf("sessions = %d, want 0", s.sessions.Count())
	}
	if r, _ := post(t, s.h, "/api/v1/auth/refresh", c.Value, ""); r.code != 401 {
		t.Errorf("refresh after logout = %d, want 401", r.code)
	}
}

func TestLogoutWithoutACookieIsFine(t *testing.T) {
	s := newSessionServer(t)
	if r, _ := post(t, s.h, "/api/v1/auth/logout", "", ""); r.code != 204 {
		t.Errorf("status = %d, want 204", r.code)
	}
}

func TestEachLoginIsItsOwnSession(t *testing.T) {
	s := newSessionServer(t)
	_, phone := s.login(t)
	_, laptop := post(t, s.h, "/api/v1/auth/login", "", `{"email":"user@example.com","password":"correct horse battery"}`)

	post(t, s.h, "/api/v1/auth/logout", phone.Value, "")
	if r, _ := post(t, s.h, "/api/v1/auth/refresh", laptop.Value, ""); r.code != 200 {
		t.Errorf("logging out on one device must not sign out the other: %d", r.code)
	}
}

func TestWithoutSessionsRefreshIsRefused(t *testing.T) {
	h, _ := newServer(t) // no session store configured
	r, c := post(t, h, "/api/v1/auth/login", "", `{"email":"x@example.com","password":"whatever pass"}`)
	if c != nil {
		t.Errorf("no cookie expected, got %v (%d)", c, r.code)
	}
	if r, _ := post(t, h, "/api/v1/auth/refresh", "anything", ""); r.code != 401 {
		t.Errorf("status = %d, want 401", r.code)
	}
}
