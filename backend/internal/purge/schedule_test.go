package purge

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

type fakeLocker struct {
	ok       bool
	err      error
	taken    atomic.Int32
	released atomic.Int32
}

func (l *fakeLocker) TryLock(context.Context) (func(), bool, error) {
	if l.err != nil {
		return nil, false, l.err
	}
	if !l.ok {
		return nil, false, nil
	}
	l.taken.Add(1)
	return func() { l.released.Add(1) }, true, nil
}

type fakeRunner struct {
	runs atomic.Int32
	err  error
}

func (r *fakeRunner) Run(context.Context) (Result, error) {
	r.runs.Add(1)
	return Result{}, r.err
}

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// start runs Schedule in the background and returns a function that stops it and waits.
func start(t *testing.T, interval time.Duration, l Locker, r Runner) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); Schedule(ctx, interval, l, r, quiet) }()
	return func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("Schedule did not stop after the context was cancelled")
		}
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached in time")
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func TestScheduleRunsImmediatelyAndRepeats(t *testing.T) {
	l, r := &fakeLocker{ok: true}, &fakeRunner{}
	stop := start(t, 5*time.Millisecond, l, r)
	waitFor(t, func() bool { return r.runs.Load() >= 3 })
	stop()
	if l.released.Load() != l.taken.Load() {
		t.Errorf("every lock taken must be released: taken %d, released %d", l.taken.Load(), l.released.Load())
	}
}

func TestScheduleFirstRunIsNotDelayedByTheInterval(t *testing.T) {
	r := &fakeRunner{}
	stop := start(t, time.Hour, &fakeLocker{ok: true}, r)
	waitFor(t, func() bool { return r.runs.Load() == 1 })
	stop()
}

func TestScheduleSkipsWhenAnotherInstanceHoldsTheLock(t *testing.T) {
	l, r := &fakeLocker{ok: false}, &fakeRunner{}
	stop := start(t, 5*time.Millisecond, l, r)
	time.Sleep(40 * time.Millisecond)
	stop()
	if r.runs.Load() != 0 {
		t.Errorf("purge ran %d times without holding the lock", r.runs.Load())
	}
}

func TestScheduleDoesNotRunWhenLockingFails(t *testing.T) {
	r := &fakeRunner{}
	stop := start(t, 5*time.Millisecond, &fakeLocker{err: errors.New("db down")}, r)
	time.Sleep(40 * time.Millisecond)
	stop()
	if r.runs.Load() != 0 {
		t.Errorf("purge ran %d times although the lock could not be taken", r.runs.Load())
	}
}

func TestScheduleKeepsGoingAndReleasesAfterFailures(t *testing.T) {
	l, r := &fakeLocker{ok: true}, &fakeRunner{err: errors.New("boom")}
	stop := start(t, 5*time.Millisecond, l, r)
	waitFor(t, func() bool { return r.runs.Load() >= 3 }) // a failed run does not end the schedule
	stop()
	if l.released.Load() != l.taken.Load() {
		t.Errorf("lock leaked after a failed run: taken %d, released %d", l.taken.Load(), l.released.Load())
	}
}
