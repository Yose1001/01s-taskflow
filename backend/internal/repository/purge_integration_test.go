package repository

import (
	"context"
	"testing"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/testutil"
)

const (
	pOwner   = "00000000-0000-0000-0000-0000000000a1"
	pActive  = "00000000-0000-0000-0000-00000000f001" // active project
	pExpired = "00000000-0000-0000-0000-00000000f002" // trashed, past retention
	pRecent  = "00000000-0000-0000-0000-00000000f003" // trashed, still restorable
)

var purgeNow = time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)

type purgeFixture struct {
	t      *testing.T
	db     DBTX
	cutoff time.Time
}

func (f *purgeFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.db.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("setup SQL failed: %v\n%s", err, sql)
	}
}

func (f *purgeFixture) count(table string) int {
	f.t.Helper()
	var n int
	// table is a constant chosen by the tests below, never user input.
	if err := f.db.QueryRow(context.Background(), `SELECT count(*) FROM `+table).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *purgeFixture) taskExists(id string) bool {
	f.t.Helper()
	var n int
	if err := f.db.QueryRow(context.Background(), `SELECT count(*) FROM tasks WHERE id = $1::uuid`, id).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n == 1
}

// newPurgeFixture builds a database (inside a rolled-back transaction) with one of everything:
// expired, recent, boundary and active tasks and projects.
func newPurgeFixture(t *testing.T) *purgeFixture {
	tx := testutil.NewTx(t)
	f := &purgeFixture{t: t, db: tx, cutoff: purgeNow.Add(-30 * 24 * time.Hour)}
	ago := func(d time.Duration) time.Time { return purgeNow.Add(-d) }
	day := 24 * time.Hour

	f.exec(`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1::uuid, 'purge@test.local', 'x', 'P')`, pOwner)
	for _, id := range []string{pActive, pExpired, pRecent} {
		f.exec(`INSERT INTO projects (id, name, owner_id) VALUES ($1::uuid, 'p', $2::uuid)`, id, pOwner)
		f.exec(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')`, id, pOwner)
	}
	f.exec(`UPDATE projects SET deleted_at = $2, deleted_by = $3::uuid WHERE id = $1::uuid`, pExpired, ago(31*day), pOwner)
	f.exec(`UPDATE projects SET deleted_at = $2, deleted_by = $3::uuid WHERE id = $1::uuid`, pRecent, ago(29*day), pOwner)

	task := func(id, project, title string, deletedAt *time.Time) {
		f.exec(`INSERT INTO tasks (id, project_id, title, created_by, position, deleted_at)
		        VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 1, $5)`, id, project, title, pOwner, deletedAt)
	}
	at := func(t time.Time) *time.Time { return &t }

	// Tasks in the ACTIVE project.
	task("00000000-0000-0000-0000-000000000e01", pActive, "active", nil)
	task("00000000-0000-0000-0000-000000000e02", pActive, "trashed 31 days ago", at(ago(31*day)))
	task("00000000-0000-0000-0000-000000000e03", pActive, "trashed 29 days ago", at(ago(29*day)))
	task("00000000-0000-0000-0000-000000000e04", pActive, "trashed exactly at the cutoff", at(f.cutoff))
	task("00000000-0000-0000-0000-000000000e05", pActive, "trashed 1 microsecond after the cutoff", at(f.cutoff.Add(time.Microsecond)))
	// Tasks inside the other projects.
	task("00000000-0000-0000-0000-000000000e11", pExpired, "in expired project, never trashed", nil)
	task("00000000-0000-0000-0000-000000000e12", pRecent, "in recent trashed project", nil)
	return f
}

const (
	tActive    = "00000000-0000-0000-0000-000000000e01"
	tOld       = "00000000-0000-0000-0000-000000000e02"
	tRecent    = "00000000-0000-0000-0000-000000000e03"
	tAtCutoff  = "00000000-0000-0000-0000-000000000e04"
	tJustAfter = "00000000-0000-0000-0000-000000000e05"
	tInExpired = "00000000-0000-0000-0000-000000000e11"
	tInRecent  = "00000000-0000-0000-0000-000000000e12"
)

func TestPurgeTasksDeletesOnlyExpiredTrashedTasks(t *testing.T) {
	f := newPurgeFixture(t)
	r := NewPurgeRepo(f.db)

	n, err := r.PurgeTasks(context.Background(), f.cutoff, 100)
	if err != nil {
		t.Fatalf("PurgeTasks: %v", err)
	}
	if n != 2 {
		t.Errorf("deleted %d tasks, want 2 (the 31-day-old one and the one exactly at the cutoff)", n)
	}

	want := map[string]bool{
		tActive:    true,  // never trashed: must survive
		tOld:       false, // expired
		tRecent:    true,  // still restorable
		tAtCutoff:  false, // boundary: restore needs deleted_at > cutoff, so this one is no longer restorable
		tJustAfter: true,  // 1 microsecond inside the retention period
		tInExpired: true,  // not trashed itself; only its project is
		tInRecent:  true,
	}
	for id, exists := range want {
		if got := f.taskExists(id); got != exists {
			t.Errorf("task %s exists = %v, want %v", id[len(id)-3:], got, exists)
		}
	}
}

func TestPurgeBoundaryMatchesRestoreBoundary(t *testing.T) {
	// A trashed task must be EITHER restorable OR purgeable, never both and never neither.
	f := newPurgeFixture(t)
	tasks := NewTaskRepo(f.db)
	ctx := context.Background()

	// Restore (as the service calls it) must refuse the boundary task...
	if err := tasks.RestoreTask(ctx, tAtCutoff, purgeNow, f.cutoff); err == nil {
		t.Error("a task exactly at the cutoff must NOT be restorable")
	}
	// ...and accept the one just inside the period.
	if err := tasks.RestoreTask(ctx, tJustAfter, purgeNow, f.cutoff); err != nil {
		t.Errorf("a task 1µs inside the period must be restorable: %v", err)
	}
	// Purge removes the first and leaves the second.
	if _, err := NewPurgeRepo(f.db).PurgeTasks(ctx, f.cutoff, 100); err != nil {
		t.Fatal(err)
	}
	if f.taskExists(tAtCutoff) {
		t.Error("boundary task should have been purged")
	}
	if !f.taskExists(tJustAfter) {
		t.Error("restored task must survive the purge")
	}
}

func TestPurgeProjectsCascadesOnlyForExpiredProjects(t *testing.T) {
	f := newPurgeFixture(t)
	ctx := context.Background()
	r := NewPurgeRepo(f.db)

	n, err := r.PurgeProjects(ctx, f.cutoff, 100)
	if err != nil {
		t.Fatalf("PurgeProjects: %v", err)
	}
	if n != 1 {
		t.Errorf("deleted %d projects, want 1", n)
	}
	if f.count("projects") != 2 {
		t.Errorf("projects left = %d, want 2 (active + recently trashed)", f.count("projects"))
	}
	if f.taskExists(tInExpired) {
		t.Error("tasks of an expired project must go with it")
	}
	for _, id := range []string{tActive, tInRecent, tRecent} {
		if !f.taskExists(id) {
			t.Errorf("task %s of a surviving project was deleted", id[len(id)-3:])
		}
	}
	var members int
	if err := f.db.QueryRow(ctx, `SELECT count(*) FROM project_members WHERE project_id = $1::uuid`, pExpired).Scan(&members); err != nil || members != 0 {
		t.Errorf("members of the purged project remain: %d (%v)", members, err)
	}
	if err := f.db.QueryRow(ctx, `SELECT count(*) FROM project_members`).Scan(&members); err != nil || members != 2 {
		t.Errorf("surviving projects lost members: %d (%v)", members, err)
	}
	if f.count("users") != 1 {
		t.Error("purge must never delete users")
	}
}

func TestPurgeRespectsBatchLimit(t *testing.T) {
	f := newPurgeFixture(t)
	for i := 0; i < 5; i++ {
		f.exec(`INSERT INTO tasks (project_id, title, created_by, position, deleted_at)
		        VALUES ($1::uuid, 'old', $2::uuid, 1, $3)`, pActive, pOwner, f.cutoff.Add(-time.Duration(i+1)*time.Hour))
	}
	r := NewPurgeRepo(f.db)
	ctx := context.Background()

	var total int
	var sizes []int
	for i := 0; i < 10; i++ {
		n, err := r.PurgeTasks(ctx, f.cutoff, 2)
		if err != nil {
			t.Fatal(err)
		}
		if n > 2 {
			t.Fatalf("batch deleted %d rows, limit is 2", n)
		}
		sizes = append(sizes, n)
		total += n
		if n == 0 {
			break
		}
	}
	if total != 7 { // 5 new + the two expired ones from the fixture
		t.Errorf("total deleted = %d (batches %v), want 7", total, sizes)
	}
}

func TestPurgeIsIdempotentAndLeavesLiveDataAlone(t *testing.T) {
	f := newPurgeFixture(t)
	r := NewPurgeRepo(f.db)
	ctx := context.Background()

	before := f.count("tasks")
	first, _ := r.PurgeTasks(ctx, f.cutoff, 100)
	second, err := r.PurgeTasks(ctx, f.cutoff, 100)
	if err != nil || second != 0 {
		t.Errorf("second run = (%d, %v), want (0, nil)", second, err)
	}
	if got := f.count("tasks"); got != before-first {
		t.Errorf("tasks = %d, want %d", got, before-first)
	}

	// A cutoff far in the past matches nothing, even though trashed rows exist.
	n, _ := r.PurgeTasks(ctx, f.cutoff.Add(-365*24*time.Hour), 100)
	m, _ := r.PurgeProjects(ctx, f.cutoff.Add(-365*24*time.Hour), 100)
	if n != 0 || m != 0 {
		t.Errorf("old cutoff deleted %d tasks and %d projects, want none", n, m)
	}
}
