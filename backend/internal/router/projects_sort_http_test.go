package router

import (
	"context"
	"testing"
)

// createdOn sets when a project was created. Tests run inside one transaction, where every row gets the same now().
func (e *env) createdOn(projectID, day string) {
	e.t.Helper()
	if _, err := e.tx.Exec(context.Background(), `UPDATE projects SET created_at = $2::date WHERE id = $1::uuid`, projectID, day); err != nil {
		e.t.Fatal(err)
	}
}

// projectNames returns the names on one page of the project list, in the order the API gave them.
func (e *env) projectNames(u user, query string) []string {
	e.t.Helper()
	r := do(e.t, e.h, "GET", "/api/v1/projects"+query, u.token, "")
	if r.code != 200 {
		e.t.Fatalf("list projects %s = %d %s", query, r.code, r.raw)
	}
	names := []string{}
	for _, item := range r.body["items"].([]any) {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	return names
}

func TestSortingTheProjectList(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")

	empty := e.createProject(alice, "Empty") // no tasks
	e.createdOn(empty, "2026-01-01")
	half := e.createProject(alice, "Half")
	e.createdOn(half, "2026-01-02")
	e.createTask(alice, half, `{"title":"a","status":"done"}`)
	e.createTask(alice, half, `{"title":"b"}`)
	all := e.createProject(alice, "All")
	e.createdOn(all, "2026-01-03")
	e.createTask(alice, all, `{"title":"a","status":"done"}`)
	none := e.createProject(alice, "None")
	e.createdOn(none, "2026-01-04")
	e.createTask(alice, none, `{"title":"a","status":"in_progress"}`)
	e.createProject(bob, "Not yours")

	cases := []struct {
		query string
		want  []string
	}{
		{"", []string{"None", "All", "Half", "Empty"}}, // newest first unless asked otherwise
		{"?sort=newest", []string{"None", "All", "Half", "Empty"}},
		{"?sort=oldest", []string{"Empty", "Half", "All", "None"}},
		// A project with no tasks has no progress to compare, so it goes last both ways.
		{"?sort=progress_high", []string{"All", "Half", "None", "Empty"}},
		{"?sort=progress_low", []string{"None", "Half", "All", "Empty"}},
		// The sort covers the whole list, not just one page.
		{"?sort=progress_high&pageSize=2&page=1", []string{"All", "Half"}},
		{"?sort=progress_high&pageSize=2&page=2", []string{"None", "Empty"}},
	}
	for _, c := range cases {
		if got := e.projectNames(alice, c.query); !eq(got, c.want) {
			t.Errorf("%q = %v, want %v", c.query, got, c.want)
		}
	}
}

func TestProgressSortEqualsFallBackToNewest(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	older := e.createProject(alice, "Older")
	e.createdOn(older, "2026-01-01")
	e.createTask(alice, older, `{"title":"a","status":"done"}`)
	newer := e.createProject(alice, "Newer")
	e.createdOn(newer, "2026-01-02")
	e.createTask(alice, newer, `{"title":"a","status":"done"}`)

	if got := e.projectNames(alice, "?sort=progress_high"); !eq(got, []string{"Newer", "Older"}) {
		t.Errorf("order = %v", got)
	}
}

func TestProgressSortIgnoresTasksInTheTrash(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	first := e.createProject(alice, "Looks done")
	e.createTask(alice, first, `{"title":"a","status":"done"}`)
	trashed := e.createTask(alice, first, `{"title":"b"}`)
	e.status(alice, "DELETE", "/api/v1/tasks/"+trashed, "") // what is left is all done
	second := e.createProject(alice, "Half")
	e.createTask(alice, second, `{"title":"a","status":"done"}`)
	e.createTask(alice, second, `{"title":"b"}`)

	if got := e.projectNames(alice, "?sort=progress_high"); !eq(got, []string{"Looks done", "Half"}) {
		t.Errorf("order = %v", got)
	}
}

func TestUnknownProjectSortIsRefused(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	for _, sort := range []string{"name", "bogus", "created_at"} {
		if got := e.status(alice, "GET", "/api/v1/projects?sort="+sort, ""); got != 422 {
			t.Errorf("sort=%s = %d, want 422", sort, got)
		}
	}
	// The trash has one order only, by when each project was deleted.
	gone := e.createProject(alice, "Gone")
	e.status(alice, "DELETE", "/api/v1/projects/"+gone, "")
	if got := e.projectNames(alice, "?trashed=true&sort=oldest"); !eq(got, []string{"Gone"}) {
		t.Errorf("trash = %v", got)
	}
}
