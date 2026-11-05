// Package httpx contains small HTTP response helpers shared by handlers and middleware.
package httpx

import (
	"encoding/json"
	"net/http"
)

// ErrorBody is the JSON shape of every error response (see docs/openapi.yaml).
// Code is a stable identifier the frontend translates; Message is English for developers.
type ErrorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

// WriteJSON writes v as JSON. Responses are never cached because they may contain account data.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a standard error response.
func WriteError(w http.ResponseWriter, status int, code, message string, fields map[string]string) {
	WriteJSON(w, status, ErrorBody{Code: code, Message: message, Fields: fields})
}
