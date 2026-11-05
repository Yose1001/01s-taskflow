// Package repository implements data access with SQL.
package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// DBTX is satisfied by *pgxpool.Pool and pgx.Tx, so repositories work in transactions and tests.
type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// UserRepo reads and writes the users table. All queries are parameterized.
type UserRepo struct{ db DBTX }

// NewUserRepo returns a UserRepo using db.
func NewUserRepo(db DBTX) *UserRepo { return &UserRepo{db: db} }

const userColumns = `id::text, email, password_hash, display_name, locale, theme, created_at`

func scanUser(row pgx.Row) (model.User, error) {
	var u model.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.Locale, &u.Theme, &u.CreatedAt)
	return u, err
}

// Create inserts a user. email must already be lowercase. Returns model.ErrEmailTaken on duplicates.
func (r *UserRepo) Create(ctx context.Context, email, passwordHash, displayName string) (model.User, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING `+userColumns,
		email, passwordHash, displayName))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "users_email_unique" {
			return model.User{}, model.ErrEmailTaken
		}
		return model.User{}, err
	}
	return u, nil
}

// GetByEmail returns the user with the given (lowercase) email, or model.ErrNotFound.
func (r *UserRepo) GetByEmail(ctx context.Context, email string) (model.User, error) {
	u, err := scanUser(r.db.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE email = $1`, email))
	return u, mapNotFound(err)
}

// GetByID returns the user with the given id, or model.ErrNotFound (also for malformed ids).
func (r *UserRepo) GetByID(ctx context.Context, id string) (model.User, error) {
	u, err := scanUser(r.db.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1::uuid`, id))
	return u, mapNotFound(err)
}

// UpdateSettings applies the non-nil fields of p and returns the updated user.
func (r *UserRepo) UpdateSettings(ctx context.Context, id string, p model.SettingsPatch) (model.User, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`UPDATE users
		    SET display_name = COALESCE($2, display_name),
		        locale       = COALESCE($3, locale),
		        theme        = COALESCE($4, theme)
		  WHERE id = $1::uuid
		  RETURNING `+userColumns,
		id, p.DisplayName, p.Locale, p.Theme))
	return u, mapNotFound(err)
}

func mapNotFound(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "22P02" { // invalid_text_representation (bad uuid)
		return model.ErrNotFound
	}
	return err
}
