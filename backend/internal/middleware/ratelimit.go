package middleware

import (
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
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
// By default it uses the connection's remote address only, which is right when clients connect
// directly. Behind a reverse proxy every request would share the proxy's address, so list the
// proxies you run as trusted: for a request that comes from one of them, the client is the first
// address in X-Forwarded-For (read from the right) that is not itself a trusted proxy.
// X-Forwarded-For is ignored for requests from anyone else, because anyone can send that header.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	limit   int
	window  time.Duration
	now     func() time.Time
	trusted []netip.Prefix
}

// NewRateLimiter allows limit requests per window for each client.
// trusted lists the reverse proxies (addresses or networks) whose X-Forwarded-For header may be believed.
func NewRateLimiter(limit int, window time.Duration, trusted ...netip.Prefix) *RateLimiter {
	return &RateLimiter{buckets: map[string]*bucket{}, limit: limit, window: window, now: time.Now, trusted: trusted}
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
		ok, retry := l.allow(l.clientIP(r))
		if !ok {
			secs := int(retry.Seconds()) + 1
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited", "too many requests, try again later", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (l *RateLimiter) isTrusted(a netip.Addr) bool {
	for _, p := range l.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// clientIP returns the address that identifies the caller (see RateLimiter for the proxy rules).
func (l *RateLimiter) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	remote = remote.Unmap()
	if !l.isTrusted(remote) {
		return remote.String()
	}

	// Walk X-Forwarded-For from the right: every proxy appends the address it received the request from.
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop := strings.TrimSpace(hops[i])
		if hop == "" {
			continue
		}
		a, err := netip.ParseAddr(hop)
		if err != nil {
			// Not an address: nothing further left can be believed, so fall back to the proxy itself.
			return remote.String()
		}
		a = a.Unmap()
		if !l.isTrusted(a) {
			return a.String()
		}
	}
	return remote.String()
}
