// Package service contains business logic. It must not know about HTTP.
package service

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

const (
	// MinPasswordRunes is counted in characters so Thai passwords are not penalised.
	MinPasswordRunes = 8
	// MaxPasswordBytes is bcrypt's hard limit. It is counted in BYTES: a Thai character is 3 bytes in UTF-8.
	MaxPasswordBytes = 72
	// DefaultBcryptCost is the production work factor.
	DefaultBcryptCost = 12

	maxEmailLen       = 254
	maxDisplayNameLen = 80
	tokenIssuer       = "taskflow"
)

var (
	// ErrInvalidCredentials is returned for BOTH an unknown email and a wrong password,
	// so callers cannot tell which accounts exist.
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrUnauthorized means the token is missing, malformed, expired or for a user that no longer exists.
	ErrUnauthorized = errors.New("unauthorized")
)

// ValidationError carries per-field error CODES (not translated text) for the frontend to translate.
type ValidationError struct{ Fields map[string]string }

func (e *ValidationError) Error() string { return fmt.Sprintf("validation failed: %v", e.Fields) }

// UserStore is the persistence the auth service needs (implemented by repository.UserRepo).
type UserStore interface {
	Create(ctx context.Context, email, passwordHash, displayName string) (model.User, error)
	GetByEmail(ctx context.Context, email string) (model.User, error)
	GetByID(ctx context.Context, id string) (model.User, error)
	UpdateSettings(ctx context.Context, id string, p model.SettingsPatch) (model.User, error)
}

// Token is the result of a successful login.
type Token struct {
	AccessToken string
	ExpiresIn   int // seconds
}

// Auth implements registration, login, token verification and profile settings.
type Auth struct {
	store     UserStore
	secret    []byte
	ttl       time.Duration
	cost      int
	dummyHash []byte
	now       func() time.Time
}

// Option customises Auth (used by tests).
type Option func(*Auth)

// WithBcryptCost overrides the bcrypt cost. Use a low value ONLY in tests.
func WithBcryptCost(cost int) Option { return func(a *Auth) { a.cost = cost } }

// WithClock overrides the clock (used to test token expiry).
func WithClock(now func() time.Time) Option { return func(a *Auth) { a.now = now } }

// NewAuth builds the service. secret must be at least 32 bytes.
func NewAuth(store UserStore, secret string, ttl time.Duration, opts ...Option) (*Auth, error) {
	if len(secret) < 32 {
		return nil, errors.New("JWT secret must be at least 32 bytes")
	}
	if ttl <= 0 {
		return nil, errors.New("token TTL must be positive")
	}
	a := &Auth{store: store, secret: []byte(secret), ttl: ttl, cost: DefaultBcryptCost, now: time.Now}
	for _, o := range opts {
		o(a)
	}
	// A real hash of a throwaway value: compared against when the email is unknown,
	// so login takes the same time whether or not the account exists.
	dummy, err := bcrypt.GenerateFromPassword([]byte("timing-equalisation-only"), a.cost)
	if err != nil {
		return nil, fmt.Errorf("prepare dummy hash: %w", err)
	}
	a.dummyHash = dummy
	return a, nil
}

// Register validates input and creates an account. Returns *ValidationError or model.ErrEmailTaken on failure.
func (a *Auth) Register(ctx context.Context, email, password, displayName string) (model.User, error) {
	email = NormalizeEmail(email)
	displayName = strings.TrimSpace(displayName)

	fields := map[string]string{}
	if code := validateEmail(email); code != "" {
		fields["email"] = code
	}
	if code := validatePassword(password); code != "" {
		fields["password"] = code
	}
	if code := validateDisplayName(displayName); code != "" {
		fields["displayName"] = code
	}
	if len(fields) > 0 {
		return model.User{}, &ValidationError{Fields: fields}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), a.cost)
	if err != nil {
		return model.User{}, fmt.Errorf("hash password: %w", err)
	}
	return a.store.Create(ctx, email, string(hash), displayName)
}

// Login checks credentials and issues a signed access token.
func (a *Auth) Login(ctx context.Context, email, password string) (Token, error) {
	email = NormalizeEmail(email)

	user, err := a.store.GetByEmail(ctx, email)
	switch {
	case errors.Is(err, model.ErrNotFound):
		_ = bcrypt.CompareHashAndPassword(a.dummyHash, []byte("x")) // equalise timing
		return Token{}, ErrInvalidCredentials
	case err != nil:
		return Token{}, fmt.Errorf("look up user: %w", err)
	}

	if len(password) > MaxPasswordBytes {
		_ = bcrypt.CompareHashAndPassword(a.dummyHash, []byte("x"))
		return Token{}, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return Token{}, ErrInvalidCredentials
	}
	return a.issue(user.ID)
}

func (a *Auth) issue(userID string) (Token, error) {
	now := a.now()
	claims := jwt.RegisteredClaims{
		Issuer:    tokenIssuer,
		Subject:   userID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(a.ttl)),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.secret)
	if err != nil {
		return Token{}, fmt.Errorf("sign token: %w", err)
	}
	return Token{AccessToken: signed, ExpiresIn: int(a.ttl.Seconds())}, nil
}

// Verify validates a token and returns the user id it was issued for.
// Only HS256 is accepted; expiry and issuer are required.
func (a *Auth) Verify(token string) (string, error) {
	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(token, claims,
		func(*jwt.Token) (any, error) { return a.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(tokenIssuer),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(a.now),
	)
	if err != nil || claims.Subject == "" {
		return "", ErrUnauthorized
	}
	return claims.Subject, nil
}

// GetUser returns the account for an authenticated user id.
// A valid token for a deleted account yields ErrUnauthorized.
func (a *Auth) GetUser(ctx context.Context, id string) (model.User, error) {
	u, err := a.store.GetByID(ctx, id)
	if errors.Is(err, model.ErrNotFound) {
		return model.User{}, ErrUnauthorized
	}
	return u, err
}

// UpdateSettings validates and applies profile preferences.
func (a *Auth) UpdateSettings(ctx context.Context, id string, p model.SettingsPatch) (model.User, error) {
	fields := map[string]string{}
	if p.DisplayName == nil && p.Locale == nil && p.Theme == nil {
		fields["body"] = "nothing_to_update"
	}
	if p.DisplayName != nil {
		trimmed := strings.TrimSpace(*p.DisplayName)
		p.DisplayName = &trimmed
		if code := validateDisplayName(trimmed); code != "" {
			fields["displayName"] = code
		}
	}
	if p.Locale != nil && !contains(model.Locales, *p.Locale) {
		fields["locale"] = "invalid_locale"
	}
	if p.Theme != nil && !contains(model.Themes, *p.Theme) {
		fields["theme"] = "invalid_theme"
	}
	if len(fields) > 0 {
		return model.User{}, &ValidationError{Fields: fields}
	}

	u, err := a.store.UpdateSettings(ctx, id, p)
	if errors.Is(err, model.ErrNotFound) {
		return model.User{}, ErrUnauthorized
	}
	return u, err
}

// NormalizeEmail trims and lowercases an email so it matches the DB constraint.
func NormalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func validateEmail(email string) string {
	if email == "" || len(email) > maxEmailLen {
		return "invalid_email"
	}
	addr, err := mail.ParseAddress(email)
	// Reject display names ("A <a@b.c>"), comments and anything that is not a bare address.
	if err != nil || addr.Address != email {
		return "invalid_email"
	}
	at := strings.LastIndex(email, "@")
	if at < 1 || !strings.Contains(email[at+1:], ".") {
		return "invalid_email"
	}
	return ""
}

func validatePassword(p string) string {
	switch {
	case utf8.RuneCountInString(p) < MinPasswordRunes:
		return "password_too_short"
	case len(p) > MaxPasswordBytes:
		return "password_too_long"
	}
	return ""
}

func validateDisplayName(name string) string {
	n := utf8.RuneCountInString(name)
	if n < 1 || n > maxDisplayNameLen {
		return "invalid_display_name"
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "invalid_display_name"
		}
	}
	return ""
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
