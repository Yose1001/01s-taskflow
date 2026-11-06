// Package config loads runtime configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"
)

const minJWTSecretLen = 32

// Config holds settings read from the environment.
type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	JWTTTL      time.Duration
	// SessionTTL is how long a person stays signed in without using the app (refresh token lifetime).
	SessionTTL time.Duration
	// CookieSecure marks the sign-in cookie as HTTPS-only. Browsers accept it on http://localhost too.
	CookieSecure       bool
	CORSAllowedOrigins []string
	TrashRetentionDays int
	// LoginRateLimit and RegisterRateLimit are the most requests one client address may make
	// to the login / sign-up endpoint per minute. Raise them only for tests (many users share
	// one address there); keep the defaults in production.
	LoginRateLimit    int
	RegisterRateLimit int
	// TrustedProxies are the reverse proxies (addresses or networks) whose X-Forwarded-For header
	// is believed when working out who the client is. Empty (the default) means never believe it.
	TrustedProxies []netip.Prefix
}

// Load reads configuration from the environment, applying defaults
// and returning an error describing every invalid or missing value.
func Load() (Config, error) {
	cfg := Config{
		Port:               getenv("PORT", "8080"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		JWTSecret:          os.Getenv("JWT_SECRET"),
		JWTTTL:             60 * time.Minute,
		SessionTTL:         30 * 24 * time.Hour,
		CookieSecure:       true,
		CORSAllowedOrigins: splitList(os.Getenv("CORS_ALLOWED_ORIGINS")),
		TrashRetentionDays: 30,
		LoginRateLimit:     10,
		RegisterRateLimit:  5,
	}

	var errs []error

	if cfg.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	if len(cfg.JWTSecret) < minJWTSecretLen {
		errs = append(errs, fmt.Errorf("JWT_SECRET is required and must be at least %d characters (generate with: openssl rand -hex 32)", minJWTSecretLen))
	}
	if v := os.Getenv("JWT_TTL_MINUTES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			errs = append(errs, fmt.Errorf("JWT_TTL_MINUTES must be a positive integer, got %q", v))
		} else {
			cfg.JWTTTL = time.Duration(n) * time.Minute
		}
	}
	if v := os.Getenv("SESSION_TTL_DAYS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 365 {
			errs = append(errs, fmt.Errorf("SESSION_TTL_DAYS must be a whole number from 1 to 365, got %q", v))
		} else {
			cfg.SessionTTL = time.Duration(n) * 24 * time.Hour
		}
	}
	if v := os.Getenv("COOKIE_SECURE"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("COOKIE_SECURE must be true or false, got %q", v))
		} else {
			cfg.CookieSecure = b
		}
	}
	if v := os.Getenv("TRASH_RETENTION_DAYS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			errs = append(errs, fmt.Errorf("TRASH_RETENTION_DAYS must be a positive integer, got %q", v))
		} else {
			cfg.TrashRetentionDays = n
		}
	}

	for _, limit := range []struct {
		env string
		dst *int
	}{
		{"LOGIN_RATE_LIMIT_PER_MINUTE", &cfg.LoginRateLimit},
		{"REGISTER_RATE_LIMIT_PER_MINUTE", &cfg.RegisterRateLimit},
	} {
		if v := os.Getenv(limit.env); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 {
				errs = append(errs, fmt.Errorf("%s must be a positive integer, got %q", limit.env, v))
			} else {
				*limit.dst = n
			}
		}
	}

	for _, entry := range splitList(os.Getenv("TRUSTED_PROXIES")) {
		prefix, err := parseProxy(entry)
		if err != nil {
			errs = append(errs, fmt.Errorf("TRUSTED_PROXIES: %q is not an IP address or network such as 10.0.0.0/8", entry))
			continue
		}
		cfg.TrustedProxies = append(cfg.TrustedProxies, prefix)
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// parseProxy accepts a single address ("10.0.0.5") or a network ("10.0.0.0/8").
func parseProxy(s string) (netip.Prefix, error) {
	if strings.Contains(s, "/") {
		p, err := netip.ParsePrefix(s)
		return p.Masked(), err
	}
	a, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Prefix{}, err
	}
	a = a.Unmap()
	return netip.PrefixFrom(a, a.BitLen()), nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
