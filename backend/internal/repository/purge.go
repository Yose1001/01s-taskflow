package repository

import (
	"context"
	"time"
)

// PurgeRepo permanently deletes trashed rows whose retention period is over.
// This is IRREVERSIBLE, so every statement only touches rows that are already in the trash
// (deleted_at IS NOT NULL) and old enough (deleted_at <= cutoff).
type PurgeRepo struct{ db DBTX }

// NewPurgeRepo returns a PurgeRepo using db.
func NewPurgeRepo(db DBTX) *PurgeRepo { return &PurgeRepo{db: db} }

// PurgeTasks deletes up to limit expired trashed tasks and returns how many were deleted.
//
// The boundary matches restore: a task is restorable while deleted_at > cutoff and purgeable once
// deleted_at <= cutoff, so every trashed task is exactly one of the two.
// Deleting in small batches keeps locks short; SKIP LOCKED avoids waiting on rows being restored right now.
func (r *PurgeRepo) PurgeTasks(ctx context.Context, cutoff time.Time, limit int) (int, error) {
	tag, err := r.db.Exec(ctx, `
		WITH doomed AS (
			SELECT id FROM tasks
			 WHERE deleted_at IS NOT NULL AND deleted_at <= $1
			 ORDER BY deleted_at, id
			 LIMIT $2
			 FOR UPDATE SKIP LOCKED
		)
		DELETE FROM tasks t USING doomed d WHERE t.id = d.id`, cutoff, limit)
	return int(tag.RowsAffected()), err
}

// PurgeProjects deletes up to limit expired trashed projects and returns how many were deleted.
// Their members and ALL their tasks go with them (ON DELETE CASCADE), including tasks that were never trashed:
// those were already invisible because the project itself was in the trash.
func (r *PurgeRepo) PurgeProjects(ctx context.Context, cutoff time.Time, limit int) (int, error) {
	tag, err := r.db.Exec(ctx, `
		WITH doomed AS (
			SELECT id FROM projects
			 WHERE deleted_at IS NOT NULL AND deleted_at <= $1
			 ORDER BY deleted_at, id
			 LIMIT $2
			 FOR UPDATE SKIP LOCKED
		)
		DELETE FROM projects p USING doomed d WHERE p.id = d.id`, cutoff, limit)
	return int(tag.RowsAffected()), err
}
