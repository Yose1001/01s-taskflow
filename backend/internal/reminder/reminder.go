// Package reminder makes the reminders for important days when they are due.
package reminder

import (
	"context"
	"log/slog"
	"time"
)

// Generator makes the reminders due at now (a *repository.EventRepo). Making them is idempotent:
// running it again, or on two servers at once, never makes the same reminder twice.
type Generator interface {
	GenerateReminders(ctx context.Context, now time.Time, tz, remindAt string) (int64, error)
}

// Settings say when reminders go out: at RemindAt ("08:00") in the time zone TZ ("Asia/Bangkok").
type Settings struct {
	TZ       string
	RemindAt string
}

// Schedule makes due reminders right away and then every interval, until ctx is cancelled.
// It never panics the server: failures are logged and the next tick tries again.
func Schedule(ctx context.Context, interval time.Duration, g Generator, s Settings, now func() time.Time, log *slog.Logger) {
	runOnce(ctx, g, s, now, log)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOnce(ctx, g, s, now, log)
		}
	}
}

func runOnce(ctx context.Context, g Generator, s Settings, now func() time.Time, log *slog.Logger) {
	made, err := g.GenerateReminders(ctx, now(), s.TZ, s.RemindAt)
	switch {
	case err != nil && ctx.Err() != nil:
		log.Info("reminders: stopped by shutdown")
	case err != nil:
		log.Error("reminders failed", "error", err)
	case made > 0:
		log.Info("reminders made", "count", made)
	}
}
