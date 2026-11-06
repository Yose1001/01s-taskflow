package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// SessionRepo reads and writes the sessions table (refresh tokens, stored as hashes only).
type SessionRepo struct{ db DBTX }

// NewSessionRepo returns a SessionRepo using db.
func NewSessionRepo(db DBTX) *SessionRepo { return &SessionRepo{db: db} }

// CreateSession stores a new session. It also removes this user's expired sessions (cheap housekeeping).
func (r *SessionRepo) CreateSession(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	if _, err := r.db.Exec(ctx,
		`DELETE FROM sessions WHERE user_id = $1::uuid AND expires_at <= now()`, userID); err != nil {
		return err
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)`,
		userID, tokenHash, expiresAt)
	return err
}

// RotateSession swaps the current token for a new one and returns the session's user.
//
//   - oldHash is the current token: it is replaced by newHash, kept as "previous" until graceUntil,
//     and the session's expiry moves to expiresAt. rotated is true.
//   - oldHash is the previous token and the grace period has not passed (another tab won the race):
//     the user is returned with rotated false; the caller must not hand out newHash.
//   - oldHash is the previous token after the grace period: someone is replaying an old token, which
//     means it may have been stolen. The whole session is deleted and model.ErrNotFound is returned.
//   - anything else (unknown, expired): model.ErrNotFound.
func (r *SessionRepo) RotateSession(ctx context.Context, oldHash, newHash []byte, now, expiresAt, graceUntil time.Time) (string, bool, error) {
	var userID string
	err := r.db.QueryRow(ctx,
		`UPDATE sessions
		    SET token_hash = $2, previous_hash = $1, previous_valid_until = $4,
		        expires_at = $5, last_used_at = $3
		  WHERE token_hash = $1 AND expires_at > $3
		  RETURNING user_id::text`,
		oldHash, newHash, now, graceUntil, expiresAt).Scan(&userID)
	if err == nil {
		return userID, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}

	var inGrace bool
	err = r.db.QueryRow(ctx,
		`SELECT user_id::text, previous_valid_until > $2
		   FROM sessions
		  WHERE previous_hash = $1 AND expires_at > $2`,
		oldHash, now).Scan(&userID, &inGrace)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, model.ErrNotFound
	}
	if err != nil {
		return "", false, err
	}
	if inGrace {
		return userID, false, nil
	}
	if _, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE previous_hash = $1`, oldHash); err != nil {
		return "", false, err
	}
	return "", false, model.ErrNotFound
}

// DeleteSession ends the session that the token (current or previous) belongs to. Unknown tokens are ignored.
func (r *SessionRepo) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1 OR previous_hash = $1`, tokenHash)
	return err
}
