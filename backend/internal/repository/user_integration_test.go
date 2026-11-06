package repository

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// These tests need a migrated PostgreSQL. They run inside a transaction that is always
// rolled back, so no data is left behind. Skipped unless TEST_DATABASE_URL is set.
func newTx(t *testing.T) *UserRepo {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	return NewUserRepo(tx)
}

func TestUserRepoCreateAndGet(t *testing.T) {
	r := newTx(t)
	ctx := context.Background()

	u, err := r.Create(ctx, "repo@test.local", "hash", "Repo Tester")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if u.ID == "" || u.Locale != "en" || u.Theme != "light" || u.CreatedAt.IsZero() {
		t.Errorf("defaults not applied: %+v", u)
	}

	byEmail, err := r.GetByEmail(ctx, "repo@test.local")
	if err != nil || byEmail.ID != u.ID {
		t.Errorf("GetByEmail = (%+v, %v)", byEmail, err)
	}
	byID, err := r.GetByID(ctx, u.ID)
	if err != nil || byID.Email != "repo@test.local" {
		t.Errorf("GetByID = (%+v, %v)", byID, err)
	}
}

func TestUserRepoDuplicateEmail(t *testing.T) {
	r := newTx(t)
	ctx := context.Background()
	if _, err := r.Create(ctx, "dup@test.local", "h", "A"); err != nil {
		t.Fatal(err)
	}
	// A failed statement aborts the Postgres transaction, so this must be the last statement.
	if _, err := r.Create(ctx, "dup@test.local", "h", "B"); !errors.Is(err, model.ErrEmailTaken) {
		t.Errorf("err = %v, want ErrEmailTaken", err)
	}
}

func TestUserRepoNotFound(t *testing.T) {
	r := newTx(t)
	ctx := context.Background()
	if _, err := r.GetByEmail(ctx, "nobody@test.local"); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("GetByEmail err = %v, want ErrNotFound", err)
	}
	if _, err := r.GetByID(ctx, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("GetByID err = %v, want ErrNotFound", err)
	}
}

func TestUserRepoMalformedIDIsNotFound(t *testing.T) {
	r := newTx(t)
	if _, err := r.GetByID(context.Background(), "not-a-uuid"); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestUserRepoUpdateSettings(t *testing.T) {
	r := newTx(t)
	ctx := context.Background()
	u, _ := r.Create(ctx, "upd@test.local", "h", "Before")

	locale, theme := "th", "dark"
	got, err := r.UpdateSettings(ctx, u.ID, model.SettingsPatch{Locale: &locale, Theme: &theme})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got.Locale != "th" || got.Theme != "dark" || got.DisplayName != "Before" {
		t.Errorf("partial update wrong: %+v", got)
	}
}
