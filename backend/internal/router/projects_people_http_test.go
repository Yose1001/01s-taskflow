package router

import (
	"context"
	"fmt"
	"testing"
)

// listed returns the project list items for a query, by name.
func (e *env) listed(u user, query string) map[string]map[string]any {
	e.t.Helper()
	r := do(e.t, e.h, "GET", "/api/v1/projects"+query, u.token, "")
	if r.code != 200 {
		e.t.Fatalf("list projects %s = %d %s", query, r.code, r.raw)
	}
	out := map[string]map[string]any{}
	for _, item := range r.body["items"].([]any) {
		p := item.(map[string]any)
		out[p["name"].(string)] = p
	}
	return out
}

func memberNames(p map[string]any) []string {
	names := []string{}
	for _, m := range p["members"].([]any) {
		names = append(names, m.(map[string]any)["displayName"].(string))
	}
	return names
}

func TestTheProjectListShowsWhoIsInEachProject(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	id := e.createProject(alice, "Launch")
	e.addMember(alice, id, bob)

	// Everyone sees the same people: the owner first.
	for _, u := range []user{alice, bob} {
		p := e.listed(u, "")["Launch"]
		if !eq(memberNames(p), []string{"alice", "bob"}) || p["memberCount"] != float64(2) {
			t.Errorf("members = %v (%v)", p["members"], p["memberCount"])
		}
	}

	// A new project has its owner, and so does the one project read on its own.
	created := do(t, e.h, "POST", "/api/v1/projects", alice.token, `{"name":"Fresh"}`)
	if !eq(memberNames(created.body), []string{"alice"}) || created.body["memberCount"] != float64(1) {
		t.Errorf("new project = %s", created.raw)
	}
	one := do(t, e.h, "GET", "/api/v1/projects/"+id, bob.token, "")
	if !eq(memberNames(one.body), []string{"alice", "bob"}) {
		t.Errorf("one project = %s", one.raw)
	}

	// A big team: the first five come along, and the count tells how many in all.
	for i := range 5 {
		e.addMember(alice, id, e.newUser(fmt.Sprintf("m%d", i)))
	}
	p := e.listed(alice, "")["Launch"]
	if got := memberNames(p); len(got) != 5 || got[0] != "alice" || p["memberCount"] != float64(7) {
		t.Errorf("big team = %v (%v)", got, p["memberCount"])
	}
}

func TestTheProjectListCanKeepOnlyOnePersonsProjects(t *testing.T) {
	e := newEnv(t)
	alice, bob, carol := e.newUser("alice"), e.newUser("bob"), e.newUser("carol")
	withBob := e.createProject(alice, "Bob works here")
	e.addMember(alice, withBob, bob)
	e.createTask(alice, withBob, fmt.Sprintf(`{"title":"a","assigneeIds":[%q]}`, bob.id))
	mine := e.createProject(alice, "Mine")
	e.createTask(alice, mine, fmt.Sprintf(`{"title":"a","assigneeIds":[%q]}`, alice.id))
	quiet := e.createProject(alice, "Bob only watches")
	e.addMember(alice, quiet, bob)
	gone := e.createTask(alice, quiet, fmt.Sprintf(`{"title":"b","assigneeIds":[%q]}`, bob.id))
	e.status(alice, "DELETE", "/api/v1/tasks/"+gone, "") // a task in the trash does not count
	notAlices := e.createProject(carol, "Not Alice's")
	e.addMember(carol, notAlices, bob)
	e.createTask(carol, notAlices, fmt.Sprintf(`{"title":"a","assigneeIds":[%q]}`, bob.id))

	cases := []struct {
		query string
		want  []string
	}{
		{"?person=" + bob.id, []string{"Bob works here"}}, // only Alice's own projects, never Carol's
		{"?person=" + alice.id, []string{"Mine"}},
		{"?person=" + carol.id, []string{}},
	}
	for _, c := range cases {
		if got := e.projectNames(alice, c.query); !eq(got, c.want) {
			t.Errorf("%q = %v, want %v", c.query, got, c.want)
		}
	}
	r := do(t, e.h, "GET", "/api/v1/projects?person=bob", alice.token, "")
	if r.code != 422 || r.body["fields"].(map[string]any)["person"] != "invalid_id" {
		t.Errorf("person=bob = %d %s", r.code, r.raw)
	}
	if got := do(t, e.h, "GET", "/api/v1/projects?person="+bob.id, alice.token, "").body["total"]; got != float64(1) {
		t.Errorf("total = %v, want 1", got)
	}
}

func TestSortingProjectsByNameAndLatestChange(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	banana := e.createProject(alice, "banana")
	apple := e.createProject(alice, "Apple")
	cherry := e.createProject(alice, "Cherry")
	task := e.createTask(alice, cherry, `{"title":"a"}`)
	at := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.tx.Exec(context.Background(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	at(`UPDATE projects SET updated_at = '2026-01-01' WHERE id = ANY($1::uuid[])`, []string{banana, apple, cherry})
	at(`UPDATE projects SET updated_at = '2026-03-01' WHERE id = $1::uuid`, banana)
	at(`UPDATE tasks SET updated_at = '2026-05-01' WHERE id = $1::uuid`, task) // Cherry's work is the newest

	if got := e.projectNames(alice, "?sort=name"); !eq(got, []string{"Apple", "banana", "Cherry"}) {
		t.Errorf("by name = %v", got)
	}
	if got := e.projectNames(alice, "?sort=updated"); !eq(got, []string{"Cherry", "banana", "Apple"}) {
		t.Errorf("by latest change = %v", got)
	}
}
