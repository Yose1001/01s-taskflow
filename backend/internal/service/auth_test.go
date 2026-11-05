package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/Yose1001/taskflow/backend/internal/model"
	"github.com/Yose1001/taskflow/backend/internal/testutil"
)

const testSecret = "0123456789abcdef0123456789abcdef" // test only

func newAuth(t *testing.T, opts ...Option) (*Auth, *testutil.MemUserStore) {
	t.Helper()
	store := testutil.NewMemUserStore()
	opts = append([]Option{WithBcryptCost(bcryptMinCost)}, opts...)
	a, err := NewAuth(store, testSecret, time.Hour, opts...)
	if err != nil {
		t.Fatalf("NewAuth: %v", err)
	}
	return a, store
}

const bcryptMinCost = 4 // fast; production uses DefaultBcryptCost

func register(t *testing.T, a *Auth, email, pw string) model.User {
	t.Helper()
	u, err := a.Register(context.Background(), email, pw, "Tester")
	if err != nil {
		t.Fatalf("Register(%q): %v", email, err)
	}
	return u
}

func TestNewAuthRejectsWeakConfig(t *testing.T) {
	store := testutil.NewMemUserStore()
	if _, err := NewAuth(store, "too-short", time.Hour); err == nil {
		t.Error("expected error for short secret")
	}
	if _, err := NewAuth(store, testSecret, 0); err == nil {
		t.Error("expected error for zero TTL")
	}
}

func TestRegisterStoresHashNotPassword(t *testing.T) {
	a, store := newAuth(t)
	u := register(t, a, "user@example.com", "correct horse battery")

	stored, _ := store.GetByID(context.Background(), u.ID)
	if stored.PasswordHash == "" || strings.Contains(stored.PasswordHash, "correct horse") {
		t.Errorf("password must be stored hashed, got %q", stored.PasswordHash)
	}
	if !strings.HasPrefix(stored.PasswordHash, "$2") {
		t.Errorf("expected bcrypt hash, got prefix %q", stored.PasswordHash[:min(4, len(stored.PasswordHash))])
	}
}

func TestRegisterNormalizesEmail(t *testing.T) {
	a, _ := newAuth(t)
	u := register(t, a, "  MiXeD@Example.COM ", "correct horse battery")
	if u.Email != "mixed@example.com" {
		t.Errorf("Email = %q, want lowercase trimmed", u.Email)
	}
	// Different case of the same address must collide.
	_, err := a.Register(context.Background(), "MIXED@example.com", "correct horse battery", "Other")
	if !errors.Is(err, model.ErrEmailTaken) {
		t.Errorf("err = %v, want ErrEmailTaken", err)
	}
}

func TestRegisterValidation(t *testing.T) {
	a, _ := newAuth(t)
	thai25 := strings.Repeat("ก", 25) // 25 chars but 75 bytes: over bcrypt's limit
	tests := []struct {
		name, email, password, display string
		field, code                    string
	}{
		{"empty email", "", "correct horse", "N", "email", "invalid_email"},
		{"no at sign", "nope", "correct horse", "N", "email", "invalid_email"},
		{"no dot in domain", "a@b", "correct horse", "N", "email", "invalid_email"},
		{"display name in address", "A <a@b.co>", "correct horse", "N", "email", "invalid_email"},
		{"password too short", "a@b.co", "short", "N", "password", "password_too_short"},
		{"password 7 chars", "a@b.co", "1234567", "N", "password", "password_too_short"},
		{"password over 72 bytes", "a@b.co", strings.Repeat("a", 73), "N", "password", "password_too_long"},
		{"thai password over 72 bytes", "a@b.co", thai25, "N", "password", "password_too_long"},
		{"empty name", "a@b.co", "correct horse", "   ", "displayName", "invalid_display_name"},
		{"name too long", "a@b.co", "correct horse", strings.Repeat("x", 81), "displayName", "invalid_display_name"},
		{"name with control char", "a@b.co", "correct horse", "bad\x00name", "displayName", "invalid_display_name"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := a.Register(context.Background(), tc.email, tc.password, tc.display)
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want *ValidationError", err)
			}
			if ve.Fields[tc.field] != tc.code {
				t.Errorf("Fields[%s] = %q, want %q (all: %v)", tc.field, ve.Fields[tc.field], tc.code, ve.Fields)
			}
		})
	}
}

func TestRegisterAcceptsThaiPasswordAndName(t *testing.T) {
	a, _ := newAuth(t)
	// 24 Thai chars = 72 bytes (exactly the limit).
	_, err := a.Register(context.Background(), "th@example.com", strings.Repeat("ก", 24), "สมชาย ใจดี")
	if err != nil {
		t.Errorf("Thai password/name should be accepted: %v", err)
	}
}

func TestLoginSuccessAndTokenVerifies(t *testing.T) {
	a, _ := newAuth(t)
	u := register(t, a, "user@example.com", "correct horse battery")

	tok, err := a.Login(context.Background(), "USER@example.com", "correct horse battery")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if tok.ExpiresIn != 3600 {
		t.Errorf("ExpiresIn = %d, want 3600", tok.ExpiresIn)
	}
	id, err := a.Verify(tok.AccessToken)
	if err != nil || id != u.ID {
		t.Errorf("Verify = (%q, %v), want (%q, nil)", id, err, u.ID)
	}
}

func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	a, _ := newAuth(t)
	register(t, a, "user@example.com", "correct horse battery")

	cases := map[string][2]string{
		"wrong password":    {"user@example.com", "wrong password!"},
		"unknown email":     {"nobody@example.com", "correct horse battery"},
		"empty password":    {"user@example.com", ""},
		"password >72 byte": {"user@example.com", strings.Repeat("a", 100)},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := a.Login(context.Background(), c[0], c[1])
			if !errors.Is(err, ErrInvalidCredentials) {
				t.Errorf("err = %v, want ErrInvalidCredentials", err)
			}
		})
	}
}

func TestVerifyRejectsBadTokens(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	a, _ := newAuth(t, WithClock(func() time.Time { return now }))
	u := register(t, a, "user@example.com", "correct horse battery")
	good, _ := a.Login(context.Background(), "user@example.com", "correct horse battery")

	sign := func(method jwt.SigningMethod, key any, c jwt.RegisteredClaims) string {
		s, err := jwt.NewWithClaims(method, c).SignedString(key)
		if err != nil {
			t.Fatalf("sign: %v", err)
		}
		return s
	}
	valid := jwt.RegisteredClaims{
		Issuer: tokenIssuer, Subject: u.ID,
		IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	}
	expired := valid
	expired.ExpiresAt = jwt.NewNumericDate(now.Add(-time.Minute))
	noExpiry := valid
	noExpiry.ExpiresAt = nil
	wrongIssuer := valid
	wrongIssuer.Issuer = "someone-else"
	noSubject := valid
	noSubject.Subject = ""

	noneToken, _ := jwt.NewWithClaims(jwt.SigningMethodNone, valid).SignedString(jwt.UnsafeAllowNoneSignatureType)

	tests := map[string]string{
		"empty":             "",
		"garbage":           "not.a.jwt",
		"alg none":          noneToken,
		"wrong secret":      sign(jwt.SigningMethodHS256, []byte("another-secret-another-secret-123456"), valid),
		"HS512 not allowed": sign(jwt.SigningMethodHS512, []byte(testSecret), valid),
		"expired":           sign(jwt.SigningMethodHS256, []byte(testSecret), expired),
		"no expiry":         sign(jwt.SigningMethodHS256, []byte(testSecret), noExpiry),
		"wrong issuer":      sign(jwt.SigningMethodHS256, []byte(testSecret), wrongIssuer),
		"no subject":        sign(jwt.SigningMethodHS256, []byte(testSecret), noSubject),
		"tampered":          good.AccessToken[:len(good.AccessToken)-2] + "xx",
	}
	for name, tok := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := a.Verify(tok); !errors.Is(err, ErrUnauthorized) {
				t.Errorf("Verify = %v, want ErrUnauthorized", err)
			}
		})
	}
	// Sanity: a correctly built token IS accepted, so the failures above are meaningful.
	if _, err := a.Verify(sign(jwt.SigningMethodHS256, []byte(testSecret), valid)); err != nil {
		t.Errorf("valid token rejected: %v", err)
	}
}

func TestTokenExpiresAfterTTL(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	a, _ := newAuth(t, WithClock(func() time.Time { return now }))
	register(t, a, "user@example.com", "correct horse battery")
	tok, _ := a.Login(context.Background(), "user@example.com", "correct horse battery")

	if _, err := a.Verify(tok.AccessToken); err != nil {
		t.Fatalf("fresh token rejected: %v", err)
	}
	now = now.Add(time.Hour + time.Second)
	if _, err := a.Verify(tok.AccessToken); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("expired token: err = %v, want ErrUnauthorized", err)
	}
}

func TestGetUserForDeletedAccountIsUnauthorized(t *testing.T) {
	a, store := newAuth(t)
	u := register(t, a, "user@example.com", "correct horse battery")
	store.Delete(u.ID)
	if _, err := a.GetUser(context.Background(), u.ID); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("err = %v, want ErrUnauthorized", err)
	}
}

func TestUpdateSettings(t *testing.T) {
	a, _ := newAuth(t)
	u := register(t, a, "user@example.com", "correct horse battery")
	ctx := context.Background()
	str := func(s string) *string { return &s }

	got, err := a.UpdateSettings(ctx, u.ID, model.SettingsPatch{Locale: str("th"), Theme: str("dark"), DisplayName: str("  New Name ")})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got.Locale != "th" || got.Theme != "dark" || got.DisplayName != "New Name" {
		t.Errorf("got %+v", got)
	}

	for name, p := range map[string]model.SettingsPatch{
		"empty patch":    {},
		"bad locale":     {Locale: str("fr")},
		"bad theme":      {Theme: str("neon")},
		"blank name":     {DisplayName: str("  ")},
		"locale uppercs": {Locale: str("TH")},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := a.UpdateSettings(ctx, u.ID, p)
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Errorf("err = %v, want *ValidationError", err)
			}
		})
	}
}
