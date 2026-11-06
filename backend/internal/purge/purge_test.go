package purge

import (
	"context"
	"errors"
	"testing"
	"time"
)

// fakeStore pretends to hold a number of expired rows and records every call it receives.
type fakeStore struct {
	tasks, projects int // expired rows still "in the database"
	calls           []string
	cutoffs         []time.Time
	errOn           string // "tasks" or "projects": fail that step
	alwaysFull      bool   // always claim to have deleted a full batch (runaway store)
}

func (f *fakeStore) take(kind string, n *int, cutoff time.Time, limit int) (int, error) {
	f.calls = append(f.calls, kind)
	f.cutoffs = append(f.cutoffs, cutoff)
	if f.errOn == kind {
		return 0, errors.New("boom")
	}
	if f.alwaysFull {
		return limit, nil
	}
	d := min(*n, limit)
	*n -= d
	return d, nil
}

func (f *fakeStore) PurgeTasks(_ context.Context, cutoff time.Time, limit int) (int, error) {
	return f.take("tasks", &f.tasks, cutoff, limit)
}
func (f *fakeStore) PurgeProjects(_ context.Context, cutoff time.Time, limit int) (int, error) {
	return f.take("projects", &f.projects, cutoff, limit)
}

var fixedNow = time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)

func newPurger(t *testing.T, s Store, days, batch int) *Purger {
	t.Helper()
	p, err := New(s, days, batch, WithClock(func() time.Time { return fixedNow }))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return p
}

func TestNewRejectsDangerousConfig(t *testing.T) {
	// A retention of 0 or less would make EVERYTHING in the trash expired immediately.
	for _, days := range []int{0, -1, -30} {
		if _, err := New(&fakeStore{}, days, 100); err == nil {
			t.Errorf("retention %d days should be rejected", days)
		}
	}
	for _, batch := range []int{0, -5} {
		if _, err := New(&fakeStore{}, 30, batch); err == nil {
			t.Errorf("batch size %d should be rejected", batch)
		}
	}
	if _, err := New(&fakeStore{}, 1, 1); err != nil {
		t.Errorf("1 day / batch 1 should be accepted: %v", err)
	}
}

func TestCutoffIsNowMinusRetention(t *testing.T) {
	p := newPurger(t, &fakeStore{}, 30, 10)
	if want := fixedNow.Add(-30 * 24 * time.Hour); !p.Cutoff().Equal(want) {
		t.Errorf("Cutoff = %v, want %v", p.Cutoff(), want)
	}
}

func TestRunDeletesInBatchesAndStopsOnPartialBatch(t *testing.T) {
	s := &fakeStore{tasks: 1234, projects: 7}
	res, err := newPurger(t, s, 30, 500).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Tasks != 1234 || res.Projects != 7 {
		t.Errorf("result = %+v, want 1234 tasks and 7 projects", res)
	}
	want := []string{"tasks", "tasks", "tasks", "projects"} // 500 + 500 + 234, then 7
	if len(s.calls) != len(want) {
		t.Fatalf("calls = %v, want %v", s.calls, want)
	}
	for i := range want {
		if s.calls[i] != want[i] {
			t.Errorf("calls = %v, want %v", s.calls, want)
			break
		}
	}
}

func TestRunWithExactMultipleOfBatchAsksOnceMore(t *testing.T) {
	s := &fakeStore{tasks: 1000}
	res, _ := newPurger(t, s, 30, 500).Run(context.Background())
	if res.Tasks != 1000 {
		t.Errorf("deleted %d, want 1000", res.Tasks)
	}
	if n := countCalls(s, "tasks"); n != 3 { // 500, 500, 0
		t.Errorf("task calls = %d, want 3", n)
	}
}

func TestRunWithNothingToDo(t *testing.T) {
	s := &fakeStore{}
	res, err := newPurger(t, s, 30, 500).Run(context.Background())
	if err != nil || res != (Result{}) {
		t.Errorf("got (%+v, %v), want empty result and no error", res, err)
	}
	if len(s.calls) != 2 { // one look at tasks, one at projects
		t.Errorf("calls = %v", s.calls)
	}
}

func TestEveryBatchUsesTheSameCutoff(t *testing.T) {
	// The clock must not drift between batches, or one run could use two different boundaries.
	now := fixedNow
	s := &fakeStore{tasks: 1500, projects: 1500}
	p, _ := New(s, 30, 500, WithClock(func() time.Time { now = now.Add(time.Hour); return now }))
	if _, err := p.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	for i, c := range s.cutoffs {
		if !c.Equal(s.cutoffs[0]) {
			t.Fatalf("batch %d used cutoff %v, first batch used %v", i, c, s.cutoffs[0])
		}
	}
	if len(s.cutoffs) < 6 {
		t.Errorf("expected several batches, got %d", len(s.cutoffs))
	}
}

func TestTasksFailureStopsBeforeProjects(t *testing.T) {
	s := &fakeStore{tasks: 10, projects: 10, errOn: "tasks"}
	_, err := newPurger(t, s, 30, 500).Run(context.Background())
	if err == nil {
		t.Fatal("expected the error to be returned")
	}
	if countCalls(s, "projects") != 0 {
		t.Errorf("projects must not be touched after a failure: %v", s.calls)
	}
}

func TestProjectsFailureKeepsTaskCount(t *testing.T) {
	s := &fakeStore{tasks: 3, projects: 10, errOn: "projects"}
	res, err := newPurger(t, s, 30, 500).Run(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
	if res.Tasks != 3 {
		t.Errorf("tasks already deleted must be reported: %+v", res)
	}
}

func TestCancelledContextDeletesNothing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := &fakeStore{tasks: 100, projects: 100}
	_, err := newPurger(t, s, 30, 10).Run(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if len(s.calls) != 0 {
		t.Errorf("nothing should run after cancel: %v", s.calls)
	}
}

func TestRunawayStoreIsStopped(t *testing.T) {
	s := &fakeStore{alwaysFull: true}
	_, err := newPurger(t, s, 30, 5).Run(context.Background())
	if err == nil {
		t.Error("a store that never runs out must produce an error, not loop forever")
	}
}

func countCalls(s *fakeStore, kind string) int {
	n := 0
	for _, c := range s.calls {
		if c == kind {
			n++
		}
	}
	return n
}
