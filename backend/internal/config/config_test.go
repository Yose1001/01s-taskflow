package config

import (
	"strings"
	"testing"
	"time"
)

const validSecret = "0123456789abcdef0123456789abcdef" // 32 chars, test only

// setValid sets the minimum valid environment and clears optional values.
func setValid(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db?sslmode=disable")
	t.Setenv("JWT_SECRET", validSecret)
	t.Setenv("PORT", "")
	t.Setenv("JWT_TTL_MINUTES", "")
	t.Setenv("TRASH_RETENTION_DAYS", "")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
}

func TestLoadDefaults(t *testing.T) {
	setValid(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want 8080", cfg.Port)
	}
	if cfg.JWTTTL != 60*time.Minute {
		t.Errorf("JWTTTL = %v, want 60m", cfg.JWTTTL)
	}
	if cfg.TrashRetentionDays != 30 {
		t.Errorf("TrashRetentionDays = %d, want 30", cfg.TrashRetentionDays)
	}
	if len(cfg.CORSAllowedOrigins) != 0 {
		t.Errorf("CORSAllowedOrigins = %v, want empty", cfg.CORSAllowedOrigins)
	}
}

func TestLoadCustomValues(t *testing.T) {
	setValid(t)
	t.Setenv("TRASH_RETENTION_DAYS", "7")
	t.Setenv("JWT_TTL_MINUTES", "15")
	t.Setenv("CORS_ALLOWED_ORIGINS", " http://localhost:5173 , https://app.example.com ,")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.TrashRetentionDays != 7 {
		t.Errorf("TrashRetentionDays = %d, want 7", cfg.TrashRetentionDays)
	}
	if cfg.JWTTTL != 15*time.Minute {
		t.Errorf("JWTTTL = %v, want 15m", cfg.JWTTTL)
	}
	want := []string{"http://localhost:5173", "https://app.example.com"}
	if len(cfg.CORSAllowedOrigins) != 2 || cfg.CORSAllowedOrigins[0] != want[0] || cfg.CORSAllowedOrigins[1] != want[1] {
		t.Errorf("CORSAllowedOrigins = %v, want %v", cfg.CORSAllowedOrigins, want)
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	setValid(t)
	t.Setenv("DATABASE_URL", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Errorf("Load() error = %v, want mention of DATABASE_URL", err)
	}
}

func TestLoadRejectsWeakJWTSecret(t *testing.T) {
	for _, secret := range []string{"", "short", "change-me-in-dev"} {
		t.Run(secret, func(t *testing.T) {
			setValid(t)
			t.Setenv("JWT_SECRET", secret)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
				t.Errorf("Load() with secret %q: error = %v, want JWT_SECRET error", secret, err)
			}
		})
	}
}

func TestLoadInvalidNumbers(t *testing.T) {
	for _, key := range []string{"TRASH_RETENTION_DAYS", "JWT_TTL_MINUTES"} {
		for _, v := range []string{"abc", "0", "-5"} {
			t.Run(key+"="+v, func(t *testing.T) {
				setValid(t)
				t.Setenv(key, v)
				if _, err := Load(); err == nil {
					t.Errorf("Load() with %s=%q: expected error, got nil", key, v)
				}
			})
		}
	}
}

func TestLoadReportsAllProblemsTogether(t *testing.T) {
	setValid(t)
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "DATABASE_URL") || !strings.Contains(msg, "JWT_SECRET") {
		t.Errorf("error should list both problems, got: %v", msg)
	}
}
