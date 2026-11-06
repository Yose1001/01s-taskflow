package middleware

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func prefixes(t *testing.T, list ...string) []netip.Prefix {
	t.Helper()
	var out []netip.Prefix
	for _, s := range list {
		p, err := netip.ParsePrefix(s)
		if err != nil {
			t.Fatalf("bad test prefix %q: %v", s, err)
		}
		out = append(out, p)
	}
	return out
}

func TestClientIP(t *testing.T) {
	proxies := prefixes(t, "10.0.0.0/8", "192.168.1.5/32")

	tests := []struct {
		name    string
		trusted []netip.Prefix
		remote  string
		xff     []string
		want    string
	}{
		{"no trusted proxies: header is ignored", nil, "203.0.113.9:4000", []string{"1.2.3.4"}, "203.0.113.9"},
		{"direct caller that is not a proxy cannot spoof", proxies, "203.0.113.9:4000", []string{"1.2.3.4"}, "203.0.113.9"},
		{"proxy forwards the real client", proxies, "10.0.0.2:5000", []string{"198.51.100.7"}, "198.51.100.7"},
		{"client-supplied value to the left is ignored", proxies, "10.0.0.2:5000", []string{"1.2.3.4, 198.51.100.7"}, "198.51.100.7"},
		{"chain of two trusted proxies", proxies, "10.0.0.2:5000", []string{"198.51.100.7, 10.0.0.9"}, "198.51.100.7"},
		{"several header lines are read as one list", proxies, "10.0.0.2:5000", []string{"1.2.3.4", "198.51.100.7"}, "198.51.100.7"},
		{"single trusted address", proxies, "192.168.1.5:80", []string{"198.51.100.7"}, "198.51.100.7"},
		{"neighbour of a trusted address is not trusted", proxies, "192.168.1.6:80", []string{"198.51.100.7"}, "192.168.1.6"},
		{"proxy without the header: the proxy itself", proxies, "10.0.0.2:5000", nil, "10.0.0.2"},
		{"every hop trusted: the proxy itself", proxies, "10.0.0.2:5000", []string{"10.0.0.7"}, "10.0.0.2"},
		{"garbage in the header: the proxy itself", proxies, "10.0.0.2:5000", []string{"1.2.3.4, not-an-ip"}, "10.0.0.2"},
		{"empty header value: the proxy itself", proxies, "10.0.0.2:5000", []string{" , "}, "10.0.0.2"},
		{"ipv6 client", proxies, "10.0.0.2:5000", []string{"2001:db8::1"}, "2001:db8::1"},
		{"ipv4-in-ipv6 proxy address is still trusted", proxies, "[::ffff:10.0.0.2]:5000", []string{"198.51.100.7"}, "198.51.100.7"},
		{"remote without a port", proxies, "10.0.0.2", []string{"198.51.100.7"}, "198.51.100.7"},
		{"unparseable remote is used as it is", proxies, "pipe", []string{"198.51.100.7"}, "pipe"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			l := NewRateLimiter(1, time.Minute, tc.trusted...)
			req := httptest.NewRequest(http.MethodPost, "/login", nil)
			req.RemoteAddr = tc.remote
			for _, v := range tc.xff {
				req.Header.Add("X-Forwarded-For", v)
			}
			if got := l.clientIP(req); got != tc.want {
				t.Errorf("clientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

// Behind a trusted proxy, two different people must not share one allowance,
// and one person must not escape the limit by inventing header values.
func TestRateLimiterBehindProxy(t *testing.T) {
	l := NewRateLimiter(2, time.Minute, prefixes(t, "10.0.0.0/8")...)
	var user string
	h := l.Middleware(okHandler(&user))
	call := func(forwarded string) int {
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		req.RemoteAddr = "10.0.0.2:5000"
		// The proxy appends the address it saw after whatever the caller sent.
		req.Header.Set("X-Forwarded-For", forwarded)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	for i, fake := range []string{"9.9.9.1, 198.51.100.7", "9.9.9.2, 198.51.100.7"} {
		if code := call(fake); code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200", i+1, code)
		}
	}
	if code := call("9.9.9.3, 198.51.100.7"); code != http.StatusTooManyRequests {
		t.Errorf("same person with a new fake header: status = %d, want 429", code)
	}
	if code := call("203.0.113.50"); code != http.StatusOK {
		t.Errorf("a different person: status = %d, want 200", code)
	}
}
