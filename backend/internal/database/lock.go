package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Locker is a PostgreSQL advisory lock shared by every server instance connected to the same database.
// The lock belongs to ONE database session, so it is taken and released on the same dedicated connection.
type Locker struct {
	pool *pgxpool.Pool
	key  int64
}

// NewLocker returns a Locker for the given application-chosen key.
func NewLocker(pool *pgxpool.Pool, key int64) *Locker { return &Locker{pool: pool, key: key} }

// TryLock takes the lock without waiting. When ok is true the caller MUST call release.
func (l *Locker) TryLock(ctx context.Context) (release func(), ok bool, err error) {
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}

	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, l.key).Scan(&got); err != nil {
		conn.Release()
		return nil, false, err
	}
	if !got {
		conn.Release()
		return nil, false, nil
	}

	return func() {
		// Use a fresh context so the lock is released even when ctx was cancelled (shutdown).
		uctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var unlocked bool
		if err := conn.QueryRow(uctx, `SELECT pg_advisory_unlock($1)`, l.key).Scan(&unlocked); err != nil || !unlocked {
			// Never hand a connection that may still hold the lock back to the pool: close it,
			// which makes PostgreSQL drop the session lock.
			_ = conn.Conn().Close(uctx)
		}
		conn.Release()
	}, true, nil
}
