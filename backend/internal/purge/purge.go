// Package purge permanently removes trashed data once its retention period is over.
package purge

import (
	"context"
	"errors"
	"time"
)

const (
	// MinRetention is a safety floor: a typo in configuration (say 0 days) must never wipe the whole trash.
	MinRetention = 24 * time.Hour

	// maxBatchesPerRun bounds one run, so a misbehaving store cannot loop forever.
	maxBatchesPerRun = 10000
)

// Store deletes expired rows in batches and reports how many it deleted.
type Store interface {
	PurgeTasks(ctx context.Context, cutoff time.Time, limit int) (int, error)
	PurgeProjects(ctx context.Context, cutoff time.Time, limit int) (int, error)
}

// Result says how many rows one run deleted.
type Result struct {
	Tasks    int
	Projects int
}

// Purger deletes what has been in the trash longer than the retention period.
type Purger struct {
	store     Store
	retention time.Duration
	batch     int
	now       func() time.Time
}

// Option customises a Purger (used by tests).
type Option func(*Purger)

// WithClock overrides the clock.
func WithClock(now func() time.Time) Option { return func(p *Purger) { p.now = now } }

// New builds a Purger. retentionDays must be at least 1 and batchSize at least 1.
func New(store Store, retentionDays, batchSize int, opts ...Option) (*Purger, error) {
	retention := time.Duration(retentionDays) * 24 * time.Hour
	if retention < MinRetention {
		return nil, errors.New("purge: retention must be at least 1 day")
	}
	if batchSize < 1 {
		return nil, errors.New("purge: batch size must be at least 1")
	}
	p := &Purger{store: store, retention: retention, batch: batchSize, now: time.Now}
	for _, o := range opts {
		o(p)
	}
	return p, nil
}

// Cutoff is the instant at or before which a trashed row is expired.
func (p *Purger) Cutoff() time.Time { return p.now().Add(-p.retention) }

// Run deletes expired tasks, then expired projects, in batches. It stops early (returning what it did so far)
// if ctx is cancelled or a batch fails.
func (p *Purger) Run(ctx context.Context) (Result, error) {
	cutoff := p.Cutoff() // fixed for the whole run so every batch uses the same boundary
	var res Result

	var err error
	res.Tasks, err = p.drain(ctx, func(ctx context.Context) (int, error) { return p.store.PurgeTasks(ctx, cutoff, p.batch) })
	if err != nil {
		return res, err
	}
	res.Projects, err = p.drain(ctx, func(ctx context.Context) (int, error) { return p.store.PurgeProjects(ctx, cutoff, p.batch) })
	return res, err
}

// drain calls step until it deletes fewer rows than a full batch.
func (p *Purger) drain(ctx context.Context, step func(context.Context) (int, error)) (int, error) {
	total := 0
	for i := 0; i < maxBatchesPerRun; i++ {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := step(ctx)
		total += n
		if err != nil {
			return total, err
		}
		if n < p.batch {
			return total, nil
		}
	}
	return total, errors.New("purge: too many batches in one run")
}
