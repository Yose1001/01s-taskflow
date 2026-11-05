package router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func get(t *testing.T, h http.Handler, path string) (int, map[string]string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec.Code, body
}

func TestHealthDoesNotNeedDatabase(t *testing.T) {
	code, body := get(t, New(Deps{}), "/api/v1/health")
	if code != http.StatusOK || body["status"] != "ok" {
		t.Errorf("got %d %v, want 200 status=ok", code, body)
	}
}

func TestReadyWhenDatabaseUp(t *testing.T) {
	code, body := get(t, New(Deps{DB: fakePinger{}}), "/api/v1/ready")
	if code != http.StatusOK || body["status"] != "ready" {
		t.Errorf("got %d %v, want 200 status=ready", code, body)
	}
}

func TestReadyWhenDatabaseDown(t *testing.T) {
	code, body := get(t, New(Deps{DB: fakePinger{err: errors.New("password=secret host=db")}}), "/api/v1/ready")
	if code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", code)
	}
	if body["status"] != "unavailable" {
		t.Errorf("status field = %q, want unavailable", body["status"])
	}
	for k, v := range body {
		if v == "password=secret host=db" || k == "error" {
			t.Errorf("response leaks error detail: %v", body)
		}
	}
}

func TestReadyWithoutDatabaseConfigured(t *testing.T) {
	code, _ := get(t, New(Deps{}), "/api/v1/ready")
	if code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", code)
	}
}

func TestUnknownRouteIs404(t *testing.T) {
	code, _ := get(t, New(Deps{}), "/nope")
	if code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", code)
	}
}
