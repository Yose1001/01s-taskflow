package purge

import (
	"context"
	"log/slog"
	"time"
)

// Locker makes sure only one server instance purges at a time.
type Locker interface {
	// TryLock returns ok=false (and a nil release) when another instance holds the lock.
	TryLock(ctx context.Context) (release func(), ok bool, err error)
}

// Runner is what the scheduler runs (a *Purger).
type Runner interface {
	Run(ctx context.Context) (Result, error)
}

// Schedule runs the purger once right away and then every interval, until ctx is cancelled.
// It never panics the server: failures are logged and the next tick tries again.
func Schedule(ctx context.Context, interval time.Duration, locker Locker, r Runner, log *slog.Logger) {
	runOnce(ctx, locker, r, log)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOnce(ctx, locker, r, log)
		}
	}
}

func runOnce(ctx context.Context, locker Locker, r Runner, log *slog.Logger) {
	release, ok, err := locker.TryLock(ctx)
	if err != nil {
		if ctx.Err() == nil {
			log.Error("purge: cannot take lock", "error", err)
		}
		return
	}
	if !ok {
		log.Info("purge: another instance is running it, skipping")
		return
	}
	defer release()

	start := time.Now()
	res, err := r.Run(ctx)
	switch {
	case err != nil && ctx.Err() != nil:
		log.Info("purge: stopped by shutdown", "tasks", res.Tasks, "projects", res.Projects)
	case err != nil:
		log.Error("purge failed", "error", err, "tasks", res.Tasks, "projects", res.Projects)
	default:
		log.Info("purge finished", "tasks", res.Tasks, "projects", res.Projects, "took", time.Since(start).String())
	}
}
