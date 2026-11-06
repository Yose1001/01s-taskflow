package repository

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/model"
	"github.com/Yose1001/taskflow/backend/internal/testutil"
)

// h hashes a made-up token the way the service does.
func h(s string) []byte { sum := sha256.Sum256([]byte(s)); return sum[:] }

func TestSessionRepoRotationGraceAndReplay(t *testing.T) {
	tx := testutil.NewTx(t)
	ctx := context.Background()
	u, err := NewUserRepo(tx).Create(ctx, "session@test.local", "h", "S")
	if err != nil {
		t.Fatal(err)
	}
	r := NewSessionRepo(tx)
	now := time.Now().UTC()
	month := now.Add(30 * 24 * time.Hour)

	if err := r.CreateSession(ctx, u.ID, h("a"), month); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Current token: rotated.
	uid, rotated, err := r.RotateSession(ctx, h("a"), h("b"), now, month, now.Add(30*time.Second))
	if err != nil || uid != u.ID || !rotated {
		t.Fatalf("rotate current = (%q, %v, %v)", uid, rotated, err)
	}
	// Old token inside the grace period: accepted, not rotated again.
	uid, rotated, err = r.RotateSession(ctx, h("a"), h("c"), now.Add(5*time.Second), month, now)
	if err != nil || uid != u.ID || rotated {
		t.Fatalf("rotate in grace = (%q, %v, %v)", uid, rotated, err)
	}
	// Unknown token.
	if _, _, err := r.RotateSession(ctx, h("zzz"), h("d"), now, month, now); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("unknown token err = %v", err)
	}
	// Old token after the grace period: the whole session is ended.
	later := now.Add(time.Minute)
	if _, _, err := r.RotateSession(ctx, h("a"), h("e"), later, month, later); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("replay err = %v", err)
	}
	if _, _, err := r.RotateSession(ctx, h("b"), h("f"), later, month, later); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("current token after replay err = %v, want ErrNotFound", err)
	}
}

func TestSessionRepoExpiryAndDelete(t *testing.T) {
	tx := testutil.NewTx(t)
	ctx := context.Background()
	u, _ := NewUserRepo(tx).Create(ctx, "session2@test.local", "h", "S")
	r := NewSessionRepo(tx)
	now := time.Now().UTC()

	_ = r.CreateSession(ctx, u.ID, h("old"), now.Add(-time.Hour)) // already expired
	if _, _, err := r.RotateSession(ctx, h("old"), h("x"), now, now.Add(time.Hour), now); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("expired token err = %v", err)
	}

	// A new login cleans up this user's expired sessions.
	_ = r.CreateSession(ctx, u.ID, h("new"), now.Add(time.Hour))
	var n int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE user_id = $1::uuid`, u.ID).Scan(&n)
	if n != 1 {
		t.Errorf("sessions = %d, want 1 (expired one removed)", n)
	}

	if err := r.DeleteSession(ctx, h("new")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.RotateSession(ctx, h("new"), h("y"), now, now.Add(time.Hour), now); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("deleted session err = %v", err)
	}
}

func TestSessionsAreRemovedWithTheirUser(t *testing.T) {
	tx := testutil.NewTx(t)
	ctx := context.Background()
	u, _ := NewUserRepo(tx).Create(ctx, "session3@test.local", "h", "S")
	_ = NewSessionRepo(tx).CreateSession(ctx, u.ID, h("t"), time.Now().Add(time.Hour))
	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, u.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE user_id = $1::uuid`, u.ID).Scan(&n)
	if n != 0 {
		t.Errorf("sessions = %d, want 0", n)
	}
}
