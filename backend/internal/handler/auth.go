// Package handler translates HTTP requests into service calls and back.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/httpx"
	"github.com/Yose1001/taskflow/backend/internal/middleware"
	"github.com/Yose1001/taskflow/backend/internal/model"
	"github.com/Yose1001/taskflow/backend/internal/service"
)

const maxBodyBytes = 1 << 20 // 1 MiB

// AuthService is what the handlers need from the service layer.
type AuthService interface {
	Register(ctx context.Context, email, password, displayName string) (model.User, error)
	Login(ctx context.Context, email, password string) (service.Token, error)
	GetUser(ctx context.Context, id string) (model.User, error)
	UpdateSettings(ctx context.Context, id string, p model.SettingsPatch) (model.User, error)
}

// Auth serves /auth/* and /me.
type Auth struct{ svc AuthService }

// NewAuth returns the auth handlers.
func NewAuth(svc AuthService) *Auth { return &Auth{svc: svc} }

type userResponse struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	Locale      string    `json:"locale"`
	Theme       string    `json:"theme"`
	CreatedAt   time.Time `json:"createdAt"`
}

// toUserResponse deliberately omits the password hash.
func toUserResponse(u model.User) userResponse {
	return userResponse{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, Locale: u.Locale, Theme: u.Theme, CreatedAt: u.CreatedAt}
}

// Register handles POST /auth/register.
func (h *Auth) Register(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, err := h.svc.Register(r.Context(), in.Email, in.Password, in.DisplayName)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toUserResponse(u))
}

// Login handles POST /auth/login.
func (h *Auth) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	tok, err := h.svc.Login(r.Context(), in.Email, in.Password)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken": tok.AccessToken,
		"tokenType":   "Bearer",
		"expiresIn":   tok.ExpiresIn,
	})
}

// Me handles GET /me (requires middleware.Authenticate).
func (h *Auth) Me(w http.ResponseWriter, r *http.Request) {
	id, ok := middleware.UserID(r.Context())
	if !ok {
		writeServiceError(w, r, service.ErrUnauthorized)
		return
	}
	u, err := h.svc.GetUser(r.Context(), id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toUserResponse(u))
}

// UpdateMe handles PATCH /me (requires middleware.Authenticate).
func (h *Auth) UpdateMe(w http.ResponseWriter, r *http.Request) {
	id, ok := middleware.UserID(r.Context())
	if !ok {
		writeServiceError(w, r, service.ErrUnauthorized)
		return
	}
	var in struct {
		DisplayName *string `json:"displayName"`
		Locale      *string `json:"locale"`
		Theme       *string `json:"theme"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, err := h.svc.UpdateSettings(r.Context(), id, model.SettingsPatch{DisplayName: in.DisplayName, Locale: in.Locale, Theme: in.Theme})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toUserResponse(u))
}

// decode reads a single JSON object, rejecting unknown fields, trailing data and oversized bodies.
// It writes the error response itself and returns false on failure.
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	err := dec.Decode(dst)
	if err == nil {
		if _, extra := dec.Token(); !errors.Is(extra, io.EOF) {
			err = errors.New("unexpected data after JSON body")
		}
	}
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "bad_request", "request body too large", nil)
		} else {
			httpx.WriteError(w, http.StatusBadRequest, "bad_request", "malformed JSON body", nil)
		}
		return false
	}
	return true
}

// writeServiceError maps service/store errors to HTTP responses.
// Unexpected errors are logged server-side and never echoed to the client.
func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *service.ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_failed", "validation failed", ve.Fields)
	case errors.Is(err, model.ErrEmailTaken):
		httpx.WriteError(w, http.StatusConflict, "email_taken", "email already registered", nil)
	case errors.Is(err, model.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "not found", nil)
	case errors.Is(err, service.ErrForbidden):
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "you do not have permission to do this", nil)
	case errors.Is(err, model.ErrAlreadyMember):
		httpx.WriteError(w, http.StatusConflict, "already_member", "user is already a member", nil)
	case errors.Is(err, service.ErrInvalidCredentials):
		httpx.WriteError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password", nil)
	case errors.Is(err, service.ErrUnauthorized):
		w.Header().Set("WWW-Authenticate", `Bearer realm="taskflow"`)
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "authentication required", nil)
	default:
		slog.ErrorContext(r.Context(), "unhandled error", "method", r.Method, "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "internal server error", nil)
	}
}
