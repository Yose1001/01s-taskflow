package router

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/handler"
	"github.com/Yose1001/taskflow/backend/internal/middleware"
	"github.com/Yose1001/taskflow/backend/internal/service"
	"github.com/Yose1001/taskflow/backend/internal/testutil"
)

const secret = "0123456789abcdef0123456789abcdef" // test only

// newServer builds the real router + handlers + service on an in-memory store.
func newServer(t *testing.T) (http.Handler, *testutil.MemUserStore) {
	t.Helper()
	store := testutil.NewMemUserStore()
	svc, err := service.NewAuth(store, secret, time.Hour, service.WithBcryptCost(4))
	if err != nil {
		t.Fatal(err)
	}
	return New(Deps{
		Auth:         handler.NewAuth(svc),
		Authenticate: middleware.Authenticate(svc),
	}), store
}

type resp struct {
	code   int
	body   map[string]any
	raw    string
	header http.Header
}

func do(t *testing.T, h http.Handler, method, path, token, body string) resp {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var parsed map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return resp{code: rec.Code, body: parsed, raw: rec.Body.String(), header: rec.Header()}
}

const regBody = `{"email":"User@Example.com","password":"correct horse battery","displayName":"Tester"}`

func registerAndLogin(t *testing.T, h http.Handler) string {
	t.Helper()
	if r := do(t, h, "POST", "/api/v1/auth/register", "", regBody); r.code != 201 {
		t.Fatalf("register: %d %s", r.code, r.raw)
	}
	r := do(t, h, "POST", "/api/v1/auth/login", "", `{"email":"user@example.com","password":"correct horse battery"}`)
	if r.code != 200 {
		t.Fatalf("login: %d %s", r.code, r.raw)
	}
	tok, _ := r.body["accessToken"].(string)
	if tok == "" {
		t.Fatalf("no accessToken in %s", r.raw)
	}
	return tok
}

func TestRegisterNeverLeaksPasswordOrHash(t *testing.T) {
	h, _ := newServer(t)
	r := do(t, h, "POST", "/api/v1/auth/register", "", regBody)
	if r.code != 201 {
		t.Fatalf("status = %d: %s", r.code, r.raw)
	}
	for _, banned := range []string{"password", "hash", "$2a$", "$2b$", "correct horse"} {
		if strings.Contains(strings.ToLower(r.raw), banned) {
			t.Errorf("response contains %q: %s", banned, r.raw)
		}
	}
	if r.body["email"] != "user@example.com" {
		t.Errorf("email = %v, want normalised lowercase", r.body["email"])
	}
	if r.header.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", r.header.Get("Cache-Control"))
	}
}

func TestRegisterErrors(t *testing.T) {
	h, _ := newServer(t)
	do(t, h, "POST", "/api/v1/auth/register", "", regBody)

	tests := []struct {
		name, body string
		status     int
		code       string
	}{
		{"duplicate email", regBody, 409, "email_taken"},
		{"duplicate email other case", `{"email":"USER@example.COM","password":"correct horse battery","displayName":"X"}`, 409, "email_taken"},
		{"validation", `{"email":"bad","password":"x","displayName":""}`, 422, "validation_failed"},
		{"malformed JSON", `{"email":`, 400, "bad_request"},
		{"unknown field", `{"email":"a@b.co","password":"correct horse","displayName":"X","isAdmin":true}`, 400, "bad_request"},
		{"trailing data", regBody + `{"x":1}`, 400, "bad_request"},
		{"empty body", ``, 400, "bad_request"},
		{"wrong types", `{"email":123}`, 400, "bad_request"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := do(t, h, "POST", "/api/v1/auth/register", "", tc.body)
			if r.code != tc.status || r.body["code"] != tc.code {
				t.Errorf("got %d code=%v, want %d code=%s (%s)", r.code, r.body["code"], tc.status, tc.code, r.raw)
			}
		})
	}
}

func TestValidationReturnsFieldCodes(t *testing.T) {
	h, _ := newServer(t)
	r := do(t, h, "POST", "/api/v1/auth/register", "", `{"email":"bad","password":"x","displayName":"ok"}`)
	fields, _ := r.body["fields"].(map[string]any)
	if fields["email"] != "invalid_email" || fields["password"] != "password_too_short" {
		t.Errorf("fields = %v", fields)
	}
}

func TestOversizedBodyRejected(t *testing.T) {
	h, _ := newServer(t)
	big := `{"email":"a@b.co","password":"correct horse","displayName":"` + strings.Repeat("x", 2<<20) + `"}`
	r := do(t, h, "POST", "/api/v1/auth/register", "", big)
	if r.code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", r.code)
	}
}

func TestLoginFailuresLookIdentical(t *testing.T) {
	h, _ := newServer(t)
	do(t, h, "POST", "/api/v1/auth/register", "", regBody)

	wrongPw := do(t, h, "POST", "/api/v1/auth/login", "", `{"email":"user@example.com","password":"wrong password"}`)
	noUser := do(t, h, "POST", "/api/v1/auth/login", "", `{"email":"ghost@example.com","password":"wrong password"}`)

	if wrongPw.code != 401 || noUser.code != 401 {
		t.Fatalf("statuses = %d, %d; want 401, 401", wrongPw.code, noUser.code)
	}
	if wrongPw.raw != noUser.raw {
		t.Errorf("responses differ, leaking account existence:\n%s\n%s", wrongPw.raw, noUser.raw)
	}
	if wrongPw.body["code"] != "invalid_credentials" {
		t.Errorf("code = %v", wrongPw.body["code"])
	}
}

func TestLoginResponseShape(t *testing.T) {
	h, _ := newServer(t)
	do(t, h, "POST", "/api/v1/auth/register", "", regBody)
	r := do(t, h, "POST", "/api/v1/auth/login", "", `{"email":"user@example.com","password":"correct horse battery"}`)
	if r.body["tokenType"] != "Bearer" || r.body["expiresIn"] != float64(3600) {
		t.Errorf("body = %v", r.body)
	}
}

func TestMeRequiresValidToken(t *testing.T) {
	h, _ := newServer(t)
	for name, tok := range map[string]string{"none": "", "garbage": "abc.def.ghi"} {
		t.Run(name, func(t *testing.T) {
			if r := do(t, h, "GET", "/api/v1/me", tok, ""); r.code != 401 {
				t.Errorf("status = %d, want 401", r.code)
			}
			if r := do(t, h, "PATCH", "/api/v1/me", tok, `{"theme":"dark"}`); r.code != 401 {
				t.Errorf("PATCH status = %d, want 401", r.code)
			}
		})
	}
}

func TestMeAndUpdateFlow(t *testing.T) {
	h, _ := newServer(t)
	tok := registerAndLogin(t, h)

	r := do(t, h, "GET", "/api/v1/me", tok, "")
	if r.code != 200 || r.body["email"] != "user@example.com" || r.body["theme"] != "system" || r.body["locale"] != "en" {
		t.Fatalf("GET /me: %d %s", r.code, r.raw)
	}

	r = do(t, h, "PATCH", "/api/v1/me", tok, `{"locale":"th","theme":"dark","displayName":"สมชาย"}`)
	if r.code != 200 || r.body["locale"] != "th" || r.body["theme"] != "dark" || r.body["displayName"] != "สมชาย" {
		t.Fatalf("PATCH /me: %d %s", r.code, r.raw)
	}

	// persisted
	r = do(t, h, "GET", "/api/v1/me", tok, "")
	if r.body["locale"] != "th" || r.body["theme"] != "dark" {
		t.Errorf("settings not persisted: %s", r.raw)
	}
}

func TestUpdateMeRejectsBadInput(t *testing.T) {
	h, _ := newServer(t)
	tok := registerAndLogin(t, h)
	for name, body := range map[string]string{
		"bad locale":       `{"locale":"fr"}`,
		"bad theme":        `{"theme":"neon"}`,
		"empty object":     `{}`,
		"blank name":       `{"displayName":"  "}`,
		"cannot set email": `{"email":"evil@example.com"}`,
		"cannot set hash":  `{"passwordHash":"x"}`,
	} {
		t.Run(name, func(t *testing.T) {
			r := do(t, h, "PATCH", "/api/v1/me", tok, body)
			if r.code != 422 && r.code != 400 {
				t.Errorf("status = %d, want 4xx (%s)", r.code, r.raw)
			}
		})
	}
	// email must be unchanged
	if r := do(t, h, "GET", "/api/v1/me", tok, ""); r.body["email"] != "user@example.com" {
		t.Errorf("email changed: %s", r.raw)
	}
}

func TestTokenForDeletedUserIsRejected(t *testing.T) {
	h, store := newServer(t)
	tok := registerAndLogin(t, h)
	me := do(t, h, "GET", "/api/v1/me", tok, "")
	store.Delete(me.body["id"].(string))

	if r := do(t, h, "GET", "/api/v1/me", tok, ""); r.code != 401 {
		t.Errorf("status = %d, want 401", r.code)
	}
}

func TestRateLimitAppliesToLogin(t *testing.T) {
	store := testutil.NewMemUserStore()
	svc, _ := service.NewAuth(store, secret, time.Hour, service.WithBcryptCost(4))
	h := New(Deps{
		Auth:       handler.NewAuth(svc),
		LoginLimit: middleware.NewRateLimiter(2, time.Minute).Middleware,
	})
	body := `{"email":"a@b.co","password":"whatever pass"}`
	post := func() int {
		req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewBufferString(body))
		req.RemoteAddr = "192.0.2.1:1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if a, b := post(), post(); a != 401 || b != 401 {
		t.Fatalf("first two = %d, %d; want 401, 401", a, b)
	}
	if c := post(); c != http.StatusTooManyRequests {
		t.Errorf("third = %d, want 429", c)
	}
}
