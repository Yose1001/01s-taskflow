package config

import (
	"net/netip"
	"strings"
	"testing"
)

func TestTrustedProxiesDefaultIsNone(t *testing.T) {
	setValid(t)
	t.Setenv("TRUSTED_PROXIES", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(cfg.TrustedProxies) != 0 {
		t.Errorf("TrustedProxies = %v, want none by default", cfg.TrustedProxies)
	}
}

func TestTrustedProxiesParsing(t *testing.T) {
	setValid(t)
	t.Setenv("TRUSTED_PROXIES", " 10.0.0.0/8 , 192.168.1.5,fd00::/8,::ffff:172.16.0.9, ")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	want := []netip.Prefix{
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("192.168.1.5/32"),
		netip.MustParsePrefix("fd00::/8"),
		netip.MustParsePrefix("172.16.0.9/32"), // an IPv4-in-IPv6 address is stored as plain IPv4
	}
	if len(cfg.TrustedProxies) != len(want) {
		t.Fatalf("TrustedProxies = %v, want %v", cfg.TrustedProxies, want)
	}
	for i := range want {
		if cfg.TrustedProxies[i] != want[i] {
			t.Errorf("TrustedProxies[%d] = %v, want %v", i, cfg.TrustedProxies[i], want[i])
		}
	}
}

func TestTrustedProxiesMasksNetworkBits(t *testing.T) {
	setValid(t)
	t.Setenv("TRUSTED_PROXIES", "10.1.2.3/8")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got := cfg.TrustedProxies[0]; got != netip.MustParsePrefix("10.0.0.0/8") {
		t.Errorf("TrustedProxies[0] = %v, want 10.0.0.0/8", got)
	}
}

func TestTrustedProxiesRejectsBadValues(t *testing.T) {
	for _, bad := range []string{"nginx", "10.0.0.0/99", "10.0.0", "10.0.0.1/", "*"} {
		t.Run(bad, func(t *testing.T) {
			setValid(t)
			t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8,"+bad)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), "TRUSTED_PROXIES") {
				t.Errorf("Load() error = %v, want mention of TRUSTED_PROXIES", err)
			}
		})
	}
}
