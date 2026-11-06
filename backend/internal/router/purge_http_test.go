package router

import (
	"context"
	"testing"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/purge"
	"github.com/Yose1001/taskflow/backend/internal/repository"
)

// runPurge runs the purge job against the test transaction using the test clock.
func (e *env) runPurge() purge.Result {
	e.t.Helper()
	p, err := purge.New(repository.NewPurgeRepo(e.tx), 30, 100, purge.WithClock(func() time.Time { return e.now }))
	if err != nil {
		e.t.Fatal(err)
	}
	res, err := p.Run(context.Background())
	if err != nil {
		e.t.Fatalf("purge: %v", err)
	}
	return res
}

func (e *env) rows(table, where string, args ...any) int {
	e.t.Helper()
	var n int
	// table and where are constants written in the tests, never user input.
	if err := e.tx.QueryRow(context.Background(), `SELECT count(*) FROM `+table+` WHERE `+where, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// The whole life of deleted data: delete -> restorable for 30 days -> gone for good.
func TestTrashedDataIsPurgedAfterRetentionAndNotBefore(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	keep := e.createProject(alice, "Keep")
	doomed := e.createProject(alice, "Doomed")
	liveTask := e.createTask(alice, keep, `{"title":"live"}`)
	oldTask := e.createTask(alice, keep, `{"title":"old trash"}`)
	inDoomed := e.createTask(alice, doomed, `{"title":"never trashed itself"}`)

	e.status(alice, "DELETE", "/api/v1/tasks/"+oldTask, "")
	e.status(alice, "DELETE", "/api/v1/projects/"+doomed, "")

	// Day 20: a purge run must not touch anything yet.
	e.now = e.now.Add(20 * 24 * time.Hour)
	if res := e.runPurge(); res.Tasks != 0 || res.Projects != 0 {
		t.Fatalf("day 20: purge deleted %+v, want nothing", res)
	}
	// A task deleted LATER starts its own 30 days.
	newer := e.createTask(alice, keep, `{"title":"newer trash"}`)
	e.status(alice, "DELETE", "/api/v1/tasks/"+newer, "")

	// Day 31 since the first deletions: those expire, the newer one does not.
	e.now = e.now.Add(11 * 24 * time.Hour)
	res := e.runPurge()
	if res.Tasks != 1 || res.Projects != 1 {
		t.Fatalf("day 31: purge deleted %+v, want 1 task and 1 project", res)
	}

	if e.rows("tasks", "id = $1::uuid", oldTask) != 0 {
		t.Error("expired trashed task still in the database")
	}
	if e.rows("projects", "id = $1::uuid", doomed) != 0 || e.rows("tasks", "id = $1::uuid", inDoomed) != 0 ||
		e.rows("project_members", "project_id = $1::uuid", doomed) != 0 {
		t.Error("expired trashed project (with its tasks and members) still in the database")
	}
	// Everything still usable is untouched.
	if e.rows("tasks", "id = $1::uuid", liveTask) != 1 || e.rows("projects", "id = $1::uuid", keep) != 1 {
		t.Error("live data was deleted")
	}
	if got := e.status(alice, "GET", "/api/v1/tasks/"+liveTask, ""); got != 200 {
		t.Errorf("live task unreachable after purge: %d", got)
	}
	// The newer trashed task is still restorable.
	if got := e.status(alice, "POST", "/api/v1/tasks/"+newer+"/restore", ""); got != 200 {
		t.Errorf("restoring the newer task = %d, want 200", got)
	}

	// Purged things are gone for good: nothing left to restore, and a second run does nothing.
	if got := e.status(alice, "POST", "/api/v1/tasks/"+oldTask+"/restore", ""); got != 404 {
		t.Errorf("restoring a purged task = %d, want 404", got)
	}
	if got := e.status(alice, "POST", "/api/v1/projects/"+doomed+"/restore", ""); got != 404 {
		t.Errorf("restoring a purged project = %d, want 404", got)
	}
	if again := e.runPurge(); again.Tasks != 0 || again.Projects != 0 {
		t.Errorf("second run deleted %+v, want nothing", again)
	}
}

// Restoring resets the clock: a restored item must never be purged by its old deletion date.
func TestRestoredDataIsNotPurged(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "P")
	tid := e.createTask(alice, pid, `{"title":"T"}`)

	e.status(alice, "DELETE", "/api/v1/tasks/"+tid, "")
	e.status(alice, "DELETE", "/api/v1/projects/"+pid, "")
	e.now = e.now.Add(10 * 24 * time.Hour)
	e.status(alice, "POST", "/api/v1/projects/"+pid+"/restore", "")
	e.status(alice, "POST", "/api/v1/tasks/"+tid+"/restore", "")

	e.now = e.now.Add(40 * 24 * time.Hour) // far beyond 30 days after the ORIGINAL deletion
	if res := e.runPurge(); res.Tasks != 0 || res.Projects != 0 {
		t.Errorf("purge deleted restored data: %+v", res)
	}
	if got := e.status(alice, "GET", "/api/v1/tasks/"+tid, ""); got != 200 {
		t.Errorf("restored task lost: %d", got)
	}
}
