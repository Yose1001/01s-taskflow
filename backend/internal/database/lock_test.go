package database

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests need a real PostgreSQL (TEST_DATABASE_URL). They only take advisory locks and write no data.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping DB integration test")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

const testKey int64 = 7_283_999 // not the production key, so a running server is not affected

func TestLockIsExclusiveUntilReleased(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	a, b := NewLocker(pool, testKey), NewLocker(pool, testKey)

	release, ok, err := a.TryLock(ctx)
	if err != nil || !ok {
		t.Fatalf("first TryLock = (%v, %v), want ok", ok, err)
	}
	// Always give the connection back, even when an assertion below fails. Otherwise the pool cannot
	// close and the test HANGS instead of failing cleanly.
	var once sync.Once
	releaseOnce := func() { once.Do(release) }
	t.Cleanup(releaseOnce)

	// A second instance (different connection) must not get it.
	release2nd, ok2, err := b.TryLock(ctx)
	if ok2 {
		t.Cleanup(release2nd)
	}
	if err != nil || ok2 {
		t.Fatalf("second TryLock while held = (%v, %v), want not ok", ok2, err)
	}

	releaseOnce()

	release2, ok3, err := b.TryLock(ctx)
	if err != nil || !ok3 {
		t.Fatalf("TryLock after release = (%v, %v), want ok", ok3, err)
	}
	release2()
}

func TestDifferentKeysDoNotBlockEachOther(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	r1, ok, _ := NewLocker(pool, testKey).TryLock(ctx)
	if !ok {
		t.Fatal("could not take first lock")
	}
	defer r1()
	r2, ok, err := NewLocker(pool, testKey+1).TryLock(ctx)
	if ok {
		defer r2()
	}
	if err != nil || !ok {
		t.Fatalf("different key should be free: (%v, %v)", ok, err)
	}
}

func TestReleaseWorksAfterContextIsCancelled(t *testing.T) {
	pool := testPool(t)
	ctx, cancel := context.WithCancel(context.Background())
	l := NewLocker(pool, testKey)

	release, ok, err := l.TryLock(ctx)
	if err != nil || !ok {
		t.Fatalf("TryLock = (%v, %v)", ok, err)
	}
	cancel() // e.g. the server is shutting down
	release()

	// The lock must really be free again, not stuck on a pooled connection.
	deadline := time.Now().Add(2 * time.Second)
	for {
		r2, ok, err := l.TryLock(context.Background())
		if err == nil && ok {
			r2()
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("lock still held after release with a cancelled context (ok=%v err=%v)", ok, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
