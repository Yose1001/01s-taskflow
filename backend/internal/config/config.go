// Package config loads runtime configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const minJWTSecretLen = 32

// Config holds settings read from the environment.
type Config struct {
	Port               string
	DatabaseURL        string
	JWTSecret          string
	JWTTTL             time.Duration
	CORSAllowedOrigins []string
	TrashRetentionDays int
}

// Load reads configuration from the environment, applying defaults
// and returning an error describing every invalid or missing value.
func Load() (Config, error) {
	cfg := Config{
		Port:               getenv("PORT", "8080"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		JWTSecret:          os.Getenv("JWT_SECRET"),
		JWTTTL:             60 * time.Minute,
		CORSAllowedOrigins: splitList(os.Getenv("CORS_ALLOWED_ORIGINS")),
		TrashRetentionDays: 30,
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
	if v := os.Getenv("TRASH_RETENTION_DAYS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			errs = append(errs, fmt.Errorf("TRASH_RETENTION_DAYS must be a positive integer, got %q", v))
		} else {
			cfg.TrashRetentionDays = n
		}
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
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
