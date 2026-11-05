package middleware

import (
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/httpx"
)

const maxTrackedClients = 10000

type bucket struct {
	count   int
	resetAt time.Time
}

// RateLimiter is a fixed-window limiter keyed by client IP (in memory, single instance).
//
// It uses the connection's remote address only. Behind a reverse proxy every request would
// share the proxy's address, so a trusted-proxy header setup is required before deploying that way.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	limit   int
	window  time.Duration
	now     func() time.Time
}

// NewRateLimiter allows limit requests per window for each client.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{buckets: map[string]*bucket{}, limit: limit, window: window, now: time.Now}
}

func (l *RateLimiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	if len(l.buckets) >= maxTrackedClients {
		for k, b := range l.buckets {
			if !now.Before(b.resetAt) {
				delete(l.buckets, k)
			}
		}
	}

	b, ok := l.buckets[key]
	if !ok || !now.Before(b.resetAt) {
		l.buckets[key] = &bucket{count: 1, resetAt: now.Add(l.window)}
		return true, 0
	}
	if b.count >= l.limit {
		return false, b.resetAt.Sub(now)
	}
	b.count++
	return true, 0
}

// Middleware responds 429 once a client exceeds the limit.
func (l *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok, retry := l.allow(clientIP(r))
		if !ok {
			secs := int(retry.Seconds()) + 1
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited", "too many requests, try again later", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
