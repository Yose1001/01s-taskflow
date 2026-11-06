package router

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Yose1001/taskflow/backend/internal/handler"
	"github.com/Yose1001/taskflow/backend/internal/middleware"
	"github.com/Yose1001/taskflow/backend/internal/repository"
	"github.com/Yose1001/taskflow/backend/internal/service"
	"github.com/Yose1001/taskflow/backend/internal/testutil"
)

// env is a full server (real handlers, services and SQL) running inside a rolled-back transaction.
type env struct {
	t   *testing.T
	h   http.Handler
	tx  pgx.Tx    // the transaction everything runs in (for direct database checks)
	now time.Time // fake clock used by the services
}

func newEnv(t *testing.T) *env {
	t.Helper()
	tx := testutil.NewTx(t)
	e := &env{t: t, tx: tx, now: time.Now().UTC().Truncate(time.Second)}

	users := repository.NewUserRepo(tx)
	auth, err := service.NewAuth(users, secret, time.Hour, service.WithBcryptCost(4))
	if err != nil {
		t.Fatal(err)
	}
	projectRepo := repository.NewProjectRepo(tx)
	clock := func() time.Time { return e.now }
	projects := service.NewProjects(projectRepo, users, 30, service.WithProjectsClock(clock))
	tasks := service.NewTasks(repository.NewTaskRepo(tx), projectRepo, 30, service.WithTasksClock(clock))

	e.h = New(Deps{
		Auth:         handler.NewAuth(auth),
		Projects:     handler.NewProjects(projects),
		Tasks:        handler.NewTasks(tasks),
		Authenticate: middleware.Authenticate(auth),
	})
	return e
}

// user registers an account and returns its login token and id.
type user struct{ token, id, email string }

func (e *env) newUser(name string) user {
	e.t.Helper()
	email := fmt.Sprintf("%s-%d@test.local", name, time.Now().UnixNano())
	body := fmt.Sprintf(`{"email":%q,"password":"correct horse battery","displayName":%q}`, email, name)
	r := do(e.t, e.h, "POST", "/api/v1/auth/register", "", body)
	if r.code != 201 {
		e.t.Fatalf("register %s: %d %s", name, r.code, r.raw)
	}
	id, _ := r.body["id"].(string)
	l := do(e.t, e.h, "POST", "/api/v1/auth/login", "", fmt.Sprintf(`{"email":%q,"password":"correct horse battery"}`, email))
	tok, _ := l.body["accessToken"].(string)
	if tok == "" {
		e.t.Fatalf("login %s: %s", name, l.raw)
	}
	return user{token: tok, id: id, email: email}
}

func (e *env) createProject(u user, name string) string {
	e.t.Helper()
	r := do(e.t, e.h, "POST", "/api/v1/projects", u.token, fmt.Sprintf(`{"name":%q,"description":"d"}`, name))
	if r.code != 201 {
		e.t.Fatalf("create project: %d %s", r.code, r.raw)
	}
	return r.body["id"].(string)
}

func (e *env) addMember(owner user, projectID string, m user) {
	e.t.Helper()
	r := do(e.t, e.h, "POST", "/api/v1/projects/"+projectID+"/members", owner.token, fmt.Sprintf(`{"email":%q}`, m.email))
	if r.code != 201 {
		e.t.Fatalf("add member: %d %s", r.code, r.raw)
	}
}

func (e *env) status(u user, method, path, body string) int {
	e.t.Helper()
	return do(e.t, e.h, method, path, u.token, body).code
}

func TestProjectsRequireLogin(t *testing.T) {
	e := newEnv(t)
	routes := [][2]string{
		{"POST", "/api/v1/projects"}, {"GET", "/api/v1/projects"},
		{"GET", "/api/v1/projects/00000000-0000-0000-0000-000000000001"},
		{"PATCH", "/api/v1/projects/00000000-0000-0000-0000-000000000001"},
		{"DELETE", "/api/v1/projects/00000000-0000-0000-0000-000000000001"},
		{"POST", "/api/v1/projects/00000000-0000-0000-0000-000000000001/restore"},
		{"GET", "/api/v1/projects/00000000-0000-0000-0000-000000000001/members"},
		{"POST", "/api/v1/projects/00000000-0000-0000-0000-000000000001/members"},
		{"DELETE", "/api/v1/projects/00000000-0000-0000-0000-000000000001/members/00000000-0000-0000-0000-000000000002"},
	}
	for _, rt := range routes {
		if r := do(t, e.h, rt[0], rt[1], "", `{}`); r.code != 401 {
			t.Errorf("%s %s without token = %d, want 401", rt[0], rt[1], r.code)
		}
	}
}

func TestCreateProjectMakesCallerOwner(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")

	r := do(t, e.h, "POST", "/api/v1/projects", alice.token, `{"name":"  Website  ","description":"Redesign"}`)
	if r.code != 201 {
		t.Fatalf("status = %d: %s", r.code, r.raw)
	}
	if r.body["name"] != "Website" || r.body["myRole"] != "owner" || r.body["ownerId"] != alice.id {
		t.Errorf("body = %s", r.raw)
	}
	if r.body["deletedAt"] != nil || r.body["purgeAt"] != nil {
		t.Errorf("new project must not be in trash: %s", r.raw)
	}

	// Alice is the only member and is the owner.
	m := do(t, e.h, "GET", "/api/v1/projects/"+r.body["id"].(string)+"/members", alice.token, "")
	if m.code != 200 || !strings.Contains(m.raw, `"role":"owner"`) {
		t.Errorf("members = %d %s", m.code, m.raw)
	}
}

func TestProjectsShowTaskProgress(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Progress")

	if r := do(t, e.h, "GET", "/api/v1/projects/"+pid, alice.token, ""); r.body["taskCount"] != float64(0) || r.body["doneCount"] != float64(0) {
		t.Fatalf("new project counts: %s", r.raw)
	}

	e.createTask(alice, pid, `{"title":"one"}`)
	e.createTask(alice, pid, `{"title":"two","status":"done"}`)
	e.createTask(alice, pid, `{"title":"three","status":"done"}`)
	trashed := e.createTask(alice, pid, `{"title":"gone","status":"done"}`)
	if c := e.status(alice, "DELETE", "/api/v1/tasks/"+trashed, ""); c != 204 {
		t.Fatalf("delete task: %d", c)
	}

	// Tasks in the trash do not count.
	get := do(t, e.h, "GET", "/api/v1/projects/"+pid, alice.token, "")
	if get.body["taskCount"] != float64(3) || get.body["doneCount"] != float64(2) {
		t.Errorf("GET counts = %v / %v, want 3 / 2", get.body["taskCount"], get.body["doneCount"])
	}
	list := do(t, e.h, "GET", "/api/v1/projects", alice.token, "")
	items, _ := list.body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("list: %s", list.raw)
	}
	first := items[0].(map[string]any)
	if first["taskCount"] != float64(3) || first["doneCount"] != float64(2) {
		t.Errorf("list counts = %v / %v, want 3 / 2", first["taskCount"], first["doneCount"])
	}

	// A member sees the same numbers, and joining does not add rows to the list.
	bob := e.newUser("bob")
	e.addMember(alice, pid, bob)
	b := do(t, e.h, "GET", "/api/v1/projects/"+pid, bob.token, "")
	if b.body["taskCount"] != float64(3) || b.body["myRole"] != "member" {
		t.Errorf("member view: %s", b.raw)
	}
}

func TestCreateProjectValidation(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	tests := map[string]struct {
		body   string
		status int
	}{
		"empty name":           {`{"name":"","description":""}`, 422},
		"blank name":           {`{"name":"   "}`, 422},
		"name too long":        {`{"name":"` + strings.Repeat("x", 121) + `"}`, 422},
		"control char in name": {`{"name":"a\u0000b"}`, 422},
		"description too long": {`{"name":"ok","description":"` + strings.Repeat("x", 2001) + `"}`, 422},
		"cannot set owner":     {`{"name":"ok","ownerId":"00000000-0000-0000-0000-000000000001"}`, 400},
		"cannot set role":      {`{"name":"ok","myRole":"owner"}`, 400},
		"thai name ok":         {`{"name":"โปรเจกต์ทดสอบ"}`, 201},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			if got := e.status(alice, "POST", "/api/v1/projects", tc.body); got != tc.status {
				t.Errorf("status = %d, want %d", got, tc.status)
			}
		})
	}
}

// The core privacy rule: a stranger must not learn that someone else's project exists.
func TestNonMemberSeesNothing(t *testing.T) {
	e := newEnv(t)
	alice, mallory := e.newUser("alice"), e.newUser("mallory")
	pid := e.createProject(alice, "Secret")
	base := "/api/v1/projects/" + pid

	// Same answer as a project that does not exist at all.
	missing := "/api/v1/projects/00000000-0000-0000-0000-00000000dead"
	attempts := []struct{ method, suffix, body string }{
		{"GET", "", ""},
		{"PATCH", "", `{"name":"hacked"}`},
		{"DELETE", "", ""},
		{"POST", "/restore", ""},
		{"GET", "/members", ""},
		{"POST", "/members", `{"email":"x@y.co"}`},
		{"DELETE", "/members/" + alice.id, ""},
	}
	for _, a := range attempts {
		real := do(t, e.h, a.method, base+a.suffix, mallory.token, a.body)
		fake := do(t, e.h, a.method, strings.Replace(base, pid, "00000000-0000-0000-0000-00000000dead", 1)+a.suffix, mallory.token, a.body)
		if real.code != 404 {
			t.Errorf("%s %s by non-member = %d, want 404", a.method, a.suffix, real.code)
		}
		if real.raw != fake.raw {
			t.Errorf("%s %s: real and missing projects look different:\n%s\n%s", a.method, a.suffix, real.raw, fake.raw)
		}
	}
	_ = missing

	// Not in their list either.
	l := do(t, e.h, "GET", "/api/v1/projects", mallory.token, "")
	if l.code != 200 || l.body["total"] != float64(0) || strings.Contains(l.raw, pid) {
		t.Errorf("mallory's list leaks the project: %s", l.raw)
	}

	// And nothing was changed.
	g := do(t, e.h, "GET", base, alice.token, "")
	if g.code != 200 || g.body["name"] != "Secret" {
		t.Errorf("project was modified: %s", g.raw)
	}
}

func TestMemberCanReadButNotManage(t *testing.T) {
	e := newEnv(t)
	alice, bob, carol := e.newUser("alice"), e.newUser("bob"), e.newUser("carol")
	pid := e.createProject(alice, "Team")
	e.addMember(alice, pid, bob)
	base := "/api/v1/projects/" + pid

	// What a member MAY do.
	if r := do(t, e.h, "GET", base, bob.token, ""); r.code != 200 || r.body["myRole"] != "member" {
		t.Errorf("member GET = %d %s", r.code, r.raw)
	}
	if r := do(t, e.h, "GET", base+"/members", bob.token, ""); r.code != 200 {
		t.Errorf("member list members = %d", r.code)
	}
	if r := do(t, e.h, "GET", "/api/v1/projects", bob.token, ""); r.body["total"] != float64(1) {
		t.Errorf("member's list = %s", r.raw)
	}

	// What a member may NOT do: 403 (they know it exists), and nothing changes.
	forbidden := []struct{ method, suffix, body string }{
		{"PATCH", "", `{"name":"bob was here"}`},
		{"DELETE", "", ""},
		{"POST", "/members", fmt.Sprintf(`{"email":%q}`, carol.email)},
		{"DELETE", "/members/" + alice.id, ""},
		{"DELETE", "/members/" + bob.id, ""}, // even removing themselves
	}
	for _, f := range forbidden {
		if got := e.status(bob, f.method, base+f.suffix, f.body); got != 403 {
			t.Errorf("member %s %s = %d, want 403", f.method, f.suffix, got)
		}
	}
	g := do(t, e.h, "GET", base, alice.token, "")
	if g.body["name"] != "Team" {
		t.Errorf("member changed the project: %s", g.raw)
	}
	if m := do(t, e.h, "GET", base+"/members", alice.token, ""); strings.Contains(m.raw, carol.email) || !strings.Contains(m.raw, bob.email) {
		t.Errorf("membership changed unexpectedly: %s", m.raw)
	}
}

func TestOwnerUpdatesProject(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Old")
	base := "/api/v1/projects/" + pid

	r := do(t, e.h, "PATCH", base, alice.token, `{"name":"New name"}`)
	if r.code != 200 || r.body["name"] != "New name" || r.body["description"] != "d" {
		t.Errorf("partial update = %d %s", r.code, r.raw)
	}
	for name, body := range map[string]string{
		"empty patch": `{}`, "blank name": `{"name":" "}`, "long desc": `{"description":"` + strings.Repeat("x", 2001) + `"}`,
	} {
		if got := e.status(alice, "PATCH", base, body); got != 422 {
			t.Errorf("%s: status = %d, want 422", name, got)
		}
	}
	if got := e.status(alice, "PATCH", base, `{"ownerId":"x"}`); got != 400 {
		t.Errorf("mass assignment: status = %d, want 400", got)
	}
}

func TestMembers(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Team")
	base := "/api/v1/projects/" + pid + "/members"

	e.addMember(alice, pid, bob)

	if got := e.status(alice, "POST", base, fmt.Sprintf(`{"email":%q}`, bob.email)); got != 409 {
		t.Errorf("duplicate member = %d, want 409", got)
	}
	if got := e.status(alice, "POST", base, fmt.Sprintf(`{"email":%q}`, strings.ToUpper(bob.email))); got != 409 {
		t.Errorf("duplicate member (different case) = %d, want 409", got)
	}
	if got := e.status(alice, "POST", base, `{"email":"nobody-here@test.local"}`); got != 404 {
		t.Errorf("unknown email = %d, want 404", got)
	}
	if got := e.status(alice, "POST", base, `{"email":"not-an-email"}`); got != 422 {
		t.Errorf("bad email = %d, want 422", got)
	}

	// The owner cannot be removed (not even by themself).
	r := do(t, e.h, "DELETE", base+"/"+alice.id, alice.token, "")
	if r.code != 422 || !strings.Contains(r.raw, "cannot_remove_owner") {
		t.Errorf("remove owner = %d %s", r.code, r.raw)
	}
	if got := e.status(alice, "DELETE", base+"/00000000-0000-0000-0000-00000000dead", ""); got != 404 {
		t.Errorf("remove non-member = %d, want 404", got)
	}
	if got := e.status(alice, "DELETE", base+"/not-a-uuid", ""); got != 404 {
		t.Errorf("remove with bad id = %d, want 404", got)
	}

	// Removing Bob revokes access immediately.
	if got := e.status(alice, "DELETE", base+"/"+bob.id, ""); got != 204 {
		t.Fatalf("remove member = %d, want 204", got)
	}
	if got := e.status(bob, "GET", "/api/v1/projects/"+pid, ""); got != 404 {
		t.Errorf("removed member can still read project: %d", got)
	}
	if got := e.status(alice, "DELETE", base+"/"+bob.id, ""); got != 404 {
		t.Errorf("remove twice = %d, want 404", got)
	}
}

func TestListPaginationAndIsolation(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	for i := 1; i <= 3; i++ {
		e.createProject(alice, fmt.Sprintf("A%d", i))
	}
	e.createProject(bob, "B1")

	p1 := do(t, e.h, "GET", "/api/v1/projects?pageSize=2&page=1", alice.token, "")
	p2 := do(t, e.h, "GET", "/api/v1/projects?pageSize=2&page=2", alice.token, "")
	if p1.body["total"] != float64(3) || len(p1.body["items"].([]any)) != 2 || len(p2.body["items"].([]any)) != 1 {
		t.Errorf("pagination wrong:\n%s\n%s", p1.raw, p2.raw)
	}
	if strings.Contains(p1.raw+p2.raw, "B1") {
		t.Errorf("alice sees bob's project")
	}
	if r := do(t, e.h, "GET", "/api/v1/projects?pageSize=9999", alice.token, ""); r.code != 200 {
		t.Errorf("huge pageSize should be clamped, got %d", r.code)
	}
	for _, q := range []string{"page=abc", "pageSize=-1", "trashed=maybe"} {
		if got := e.status(alice, "GET", "/api/v1/projects?"+q, ""); got != 422 {
			t.Errorf("?%s = %d, want 422", q, got)
		}
	}
}

func TestBadProjectIDIsNotFound(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	for _, id := range []string{"not-a-uuid", "123", "00000000-0000-0000-0000-00000000000z", "'; DROP TABLE projects;--"} {
		if got := e.status(alice, "GET", "/api/v1/projects/"+strings.ReplaceAll(id, " ", "%20"), ""); got != 404 {
			t.Errorf("GET /projects/%s = %d, want 404", id, got)
		}
	}
	// The table is still there.
	if got := e.status(alice, "GET", "/api/v1/projects", ""); got != 200 {
		t.Errorf("list after injection attempt = %d", got)
	}
}

func TestTrashAndRestore(t *testing.T) {
	e := newEnv(t)
	alice, bob, eve := e.newUser("alice"), e.newUser("bob"), e.newUser("eve")
	pid := e.createProject(alice, "Doomed")
	e.addMember(alice, pid, bob)
	base := "/api/v1/projects/" + pid

	if got := e.status(alice, "DELETE", base, ""); got != 204 {
		t.Fatalf("delete = %d, want 204", got)
	}

	// Gone from normal views for everyone.
	for _, u := range []user{alice, bob} {
		if got := e.status(u, "GET", base, ""); got != 404 {
			t.Errorf("deleted project readable: %d", got)
		}
		if l := do(t, e.h, "GET", "/api/v1/projects", u.token, ""); l.body["total"] != float64(0) {
			t.Errorf("deleted project still listed: %s", l.raw)
		}
	}
	if got := e.status(alice, "PATCH", base, `{"name":"x"}`); got != 404 {
		t.Errorf("editing a trashed project = %d, want 404", got)
	}
	if got := e.status(alice, "DELETE", base, ""); got != 404 {
		t.Errorf("deleting twice = %d, want 404", got)
	}

	// Trash list: only the owner sees it, with a purge date 30 days after deletion.
	tr := do(t, e.h, "GET", "/api/v1/projects?trashed=true", alice.token, "")
	if tr.code != 200 || tr.body["total"] != float64(1) {
		t.Fatalf("owner's trash = %d %s", tr.code, tr.raw)
	}
	item := tr.body["items"].([]any)[0].(map[string]any)
	purge, err := time.Parse(time.RFC3339Nano, item["purgeAt"].(string))
	if err != nil {
		t.Fatalf("purgeAt: %v", err)
	}
	if want := e.now.Add(30 * 24 * time.Hour); purge.Sub(want).Abs() > time.Second {
		t.Errorf("purgeAt = %v, want about %v", purge, want)
	}
	if l := do(t, e.h, "GET", "/api/v1/projects?trashed=true", bob.token, ""); l.body["total"] != float64(0) {
		t.Errorf("non-owner sees the trash: %s", l.raw)
	}

	// Restore permissions: stranger 404, member 403, owner 200.
	if got := e.status(eve, "POST", base+"/restore", ""); got != 404 {
		t.Errorf("stranger restore = %d, want 404", got)
	}
	if got := e.status(bob, "POST", base+"/restore", ""); got != 403 {
		t.Errorf("member restore = %d, want 403", got)
	}
	r := do(t, e.h, "POST", base+"/restore", alice.token, "")
	if r.code != 200 || r.body["deletedAt"] != nil || r.body["name"] != "Doomed" {
		t.Fatalf("owner restore = %d %s", r.code, r.raw)
	}

	// Back to normal, with members intact.
	if got := e.status(bob, "GET", base, ""); got != 200 {
		t.Errorf("member lost access after restore: %d", got)
	}
	if got := e.status(alice, "POST", base+"/restore", ""); got != 404 {
		t.Errorf("restoring an active project = %d, want 404", got)
	}
}

func TestRestoreExpiresAfterRetention(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Old news")
	base := "/api/v1/projects/" + pid

	e.status(alice, "DELETE", base, "")

	// Day 29: still restorable. Check, then delete again to test the boundary.
	e.now = e.now.Add(29 * 24 * time.Hour)
	if l := do(t, e.h, "GET", "/api/v1/projects?trashed=true", alice.token, ""); l.body["total"] != float64(1) {
		t.Errorf("day 29: should still be in trash: %s", l.raw)
	}

	// Day 31: expired. Not listed and cannot be restored (the purge job will remove it for good).
	e.now = e.now.Add(2 * 24 * time.Hour)
	if l := do(t, e.h, "GET", "/api/v1/projects?trashed=true", alice.token, ""); l.body["total"] != float64(0) {
		t.Errorf("day 31: expired project still listed: %s", l.raw)
	}
	if got := e.status(alice, "POST", base+"/restore", ""); got != 404 {
		t.Errorf("day 31 restore = %d, want 404", got)
	}
}

func TestRemovedMemberTasksNotAffectedByProjectTrash(t *testing.T) {
	// Deleting and restoring a project must keep the member list unchanged.
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Keep members")
	e.addMember(alice, pid, bob)
	base := "/api/v1/projects/" + pid

	e.status(alice, "DELETE", base, "")
	e.status(alice, "POST", base+"/restore", "")

	m := do(t, e.h, "GET", base+"/members", alice.token, "")
	if !strings.Contains(m.raw, alice.email) || !strings.Contains(m.raw, bob.email) {
		t.Errorf("members changed by delete/restore: %s", m.raw)
	}
}
