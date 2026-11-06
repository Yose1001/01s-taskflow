// Package model holds domain types shared across layers.
package model

import (
	"errors"
	"time"
)

// Sentinel errors returned by stores and mapped to HTTP statuses by handlers.
var (
	ErrNotFound   = errors.New("not found")
	ErrEmailTaken = errors.New("email already registered")
)

// Allowed values for user preferences (must match the CHECK constraints in the schema).
var (
	Locales = []string{"th", "en"}
	Themes  = []string{"light", "dark"}
)

// User is an account. PasswordHash must never be sent to clients.
type User struct {
	ID           string
	Email        string
	PasswordHash string
	DisplayName  string
	Locale       string
	Theme        string
	CreatedAt    time.Time
}

// SettingsPatch updates user preferences; nil fields are left unchanged.
type SettingsPatch struct {
	DisplayName *string
	Locale      *string
	Theme       *string
}
