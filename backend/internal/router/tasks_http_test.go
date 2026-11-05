package router

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

const zeroUUID = "00000000-0000-0000-0000-00000000dead"

// createTask creates a task and returns its id.
func (e *env) createTask(u user, projectID, body string) string {
	e.t.Helper()
	r := do(e.t, e.h, "POST", "/api/v1/projects/"+projectID+"/tasks", u.token, body)
	if r.code != 201 {
		e.t.Fatalf("create task %s: %d %s", body, r.code, r.raw)
	}
	return r.body["id"].(string)
}

func (e *env) task(u user, id string) resp {
	e.t.Helper()
	return do(e.t, e.h, "GET", "/api/v1/tasks/"+id, u.token, "")
}

// titles returns the titles of the project's tasks in board order, optionally filtered by a query string.
func (e *env) titles(u user, projectID, query string) []string {
	e.t.Helper()
	r := do(e.t, e.h, "GET", "/api/v1/projects/"+projectID+"/tasks"+query, u.token, "")
	if r.code != 200 {
		e.t.Fatalf("list tasks %s: %d %s", query, r.code, r.raw)
	}
	var out []string
	for _, it := range r.body["items"].([]any) {
		out = append(out, it.(map[string]any)["title"].(string))
	}
	return out
}

func eq(a, b []string) bool { return strings.Join(a, "|") == strings.Join(b, "|") }

func TestTasksRequireLogin(t *testing.T) {
	e := newEnv(t)
	id := "00000000-0000-0000-0000-000000000001"
	for _, rt := range [][2]string{
		{"GET", "/api/v1/projects/" + id + "/tasks"}, {"POST", "/api/v1/projects/" + id + "/tasks"},
		{"GET", "/api/v1/tasks/" + id}, {"PATCH", "/api/v1/tasks/" + id}, {"DELETE", "/api/v1/tasks/" + id},
		{"POST", "/api/v1/tasks/" + id + "/restore"}, {"POST", "/api/v1/tasks/" + id + "/move"},
	} {
		if r := do(t, e.h, rt[0], rt[1], "", `{}`); r.code != 401 {
			t.Errorf("%s %s without token = %d, want 401", rt[0], rt[1], r.code)
		}
	}
}

func TestCreateTaskDefaultsAndOrdering(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")

	r := do(t, e.h, "POST", "/api/v1/projects/"+pid+"/tasks", alice.token, `{"title":"  First  "}`)
	if r.code != 201 {
		t.Fatalf("create = %d %s", r.code, r.raw)
	}
	if r.body["title"] != "First" || r.body["status"] != "todo" || r.body["priority"] != "medium" ||
		r.body["createdBy"] != alice.id || r.body["assigneeId"] != nil || r.body["dueDate"] != nil || r.body["deletedAt"] != nil {
		t.Errorf("defaults wrong: %s", r.raw)
	}

	e.createTask(alice, pid, `{"title":"Second"}`)
	e.createTask(alice, pid, `{"title":"Review me","status":"review"}`)
	e.createTask(alice, pid, `{"title":"Third"}`)

	// New tasks go to the END of their own column.
	if got := e.titles(alice, pid, "?status=todo"); !eq(got, []string{"First", "Second", "Third"}) {
		t.Errorf("todo column = %v", got)
	}
	if got := e.titles(alice, pid, "?status=review"); !eq(got, []string{"Review me"}) {
		t.Errorf("review column = %v", got)
	}
}

func TestCreateTaskValidation(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob") // bob is NOT in the project
	pid := e.createProject(alice, "Board")
	other := e.createProject(bob, "Bob's")
	_ = other

	tests := map[string]struct {
		body   string
		status int
	}{
		"empty title":          {`{"title":""}`, 422},
		"blank title":          {`{"title":"   "}`, 422},
		"title too long":       {`{"title":"` + strings.Repeat("x", 201) + `"}`, 422},
		"control char":         {`{"title":"a\u0000b"}`, 422},
		"description too long": {`{"title":"t","description":"` + strings.Repeat("x", 5001) + `"}`, 422},
		"bad status":           {`{"title":"t","status":"archived"}`, 422},
		"bad priority":         {`{"title":"t","priority":"urgent"}`, 422},
		"bad date":             {`{"title":"t","dueDate":"2026-13-45"}`, 422},
		"date wrong format":    {`{"title":"t","dueDate":"05/11/2026"}`, 422},
		"assignee not a uuid":  {`{"title":"t","assigneeId":"bob"}`, 422},
		"assignee not member":  {fmt.Sprintf(`{"title":"t","assigneeId":%q}`, bob.id), 422},
		"assignee unknown":     {`{"title":"t","assigneeId":"` + zeroUUID + `"}`, 422},
		"cannot set project":   {`{"title":"t","projectId":"` + zeroUUID + `"}`, 400},
		"cannot set createdBy": {`{"title":"t","createdBy":"` + zeroUUID + `"}`, 400},
		"cannot set position":  {`{"title":"t","position":0}`, 400},
		"valid with everything": {fmt.Sprintf(
			`{"title":"โจทย์ภาษาไทย","description":"d","status":"review","priority":"high","assigneeId":%q,"dueDate":"2026-12-31"}`, alice.id), 201},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			if got := e.status(alice, "POST", "/api/v1/projects/"+pid+"/tasks", tc.body); got != tc.status {
				t.Errorf("status = %d, want %d", got, tc.status)
			}
		})
	}
}

func TestStrangerCannotTouchTasks(t *testing.T) {
	e := newEnv(t)
	alice, mallory := e.newUser("alice"), e.newUser("mallory")
	pid := e.createProject(alice, "Secret")
	tid := e.createTask(alice, pid, `{"title":"Top secret"}`)
	gone := e.createTask(alice, pid, `{"title":"Deleted secret"}`)
	e.status(alice, "DELETE", "/api/v1/tasks/"+gone, "")

	attempts := []struct{ method, path, body string }{
		{"GET", "/api/v1/projects/%s/tasks", ""},
		{"GET", "/api/v1/projects/%s/tasks?trashed=true", ""},
		{"POST", "/api/v1/projects/%s/tasks", `{"title":"planted"}`},
		{"GET", "/api/v1/tasks/%s", ""},
		{"PATCH", "/api/v1/tasks/%s", `{"title":"hacked"}`},
		{"DELETE", "/api/v1/tasks/%s", ""},
		{"POST", "/api/v1/tasks/%s/move", `{"status":"done"}`},
		{"POST", "/api/v1/tasks/%s/restore", ""},
	}
	for _, a := range attempts {
		id := tid
		if strings.Contains(a.path, "/projects/") {
			id = pid
		}
		if strings.HasSuffix(a.path, "/restore") {
			id = gone
		}
		real := do(t, e.h, a.method, fmt.Sprintf(a.path, id), mallory.token, a.body)
		fake := do(t, e.h, a.method, fmt.Sprintf(a.path, zeroUUID), mallory.token, a.body)
		if real.code != 404 {
			t.Errorf("%s %s by stranger = %d, want 404", a.method, a.path, real.code)
		}
		if real.raw != fake.raw {
			t.Errorf("%s %s: real and missing look different:\n%s\n%s", a.method, a.path, real.raw, fake.raw)
		}
	}

	// Nothing leaked or changed.
	g := e.task(alice, tid)
	if g.code != 200 || g.body["title"] != "Top secret" {
		t.Errorf("task modified: %s", g.raw)
	}
	if got := e.titles(alice, pid, ""); !eq(got, []string{"Top secret"}) {
		t.Errorf("tasks changed: %v", got)
	}
}

func TestMemberHasFullTaskAccess(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Team")
	e.addMember(alice, pid, bob)

	tid := e.createTask(bob, pid, fmt.Sprintf(`{"title":"By bob","assigneeId":%q}`, bob.id)) // members may assign teammates
	if r := e.task(alice, tid); r.body["createdBy"] != bob.id || r.body["assigneeId"] != bob.id {
		t.Errorf("task = %s", r.raw)
	}
	for _, c := range []struct{ method, path, body string }{
		{"PATCH", "/api/v1/tasks/" + tid, `{"title":"edited by alice"}`},
		{"POST", "/api/v1/tasks/" + tid + "/move", `{"status":"done"}`},
		{"DELETE", "/api/v1/tasks/" + tid, ""},
		{"POST", "/api/v1/tasks/" + tid + "/restore", ""},
	} {
		if got := e.status(alice, c.method, c.path, c.body); got/100 != 2 {
			t.Errorf("%s %s = %d, want 2xx", c.method, c.path, got)
		}
	}
}

func TestUpdateTask(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Board")
	e.addMember(alice, pid, bob)
	tid := e.createTask(alice, pid, `{"title":"Old","description":"keep me","priority":"low","status":"review"}`)
	path := "/api/v1/tasks/" + tid

	// Partial update leaves everything else alone (including column and position).
	before := e.task(alice, tid)
	r := do(t, e.h, "PATCH", path, alice.token, `{"title":" New "}`)
	if r.code != 200 || r.body["title"] != "New" || r.body["description"] != "keep me" || r.body["priority"] != "low" ||
		r.body["status"] != "review" || r.body["position"] != before.body["position"] {
		t.Errorf("partial update = %d %s", r.code, r.raw)
	}

	// Assign, set due date, then clear both with null.
	r = do(t, e.h, "PATCH", path, alice.token, fmt.Sprintf(`{"assigneeId":%q,"dueDate":"2026-12-31","priority":"high"}`, bob.id))
	if r.code != 200 || r.body["assigneeId"] != bob.id || r.body["dueDate"] != "2026-12-31" || r.body["priority"] != "high" {
		t.Errorf("assign = %d %s", r.code, r.raw)
	}
	r = do(t, e.h, "PATCH", path, alice.token, `{"assigneeId":null,"dueDate":null}`)
	if r.code != 200 || r.body["assigneeId"] != nil || r.body["dueDate"] != nil {
		t.Errorf("clear = %d %s", r.code, r.raw)
	}
	// Absent is different from null: untouched fields stay.
	do(t, e.h, "PATCH", path, alice.token, fmt.Sprintf(`{"assigneeId":%q}`, bob.id))
	r = do(t, e.h, "PATCH", path, alice.token, `{"title":"again"}`)
	if r.body["assigneeId"] != bob.id {
		t.Errorf("absent field changed the assignee: %s", r.raw)
	}

	bad := map[string]struct {
		body   string
		status int
	}{
		"empty patch":       {`{}`, 422},
		"blank title":       {`{"title":" "}`, 422},
		"bad priority":      {`{"priority":"x"}`, 422},
		"bad date":          {`{"dueDate":"tomorrow"}`, 422},
		"stranger assignee": {`{"assigneeId":"` + zeroUUID + `"}`, 422},
		"status via patch":  {`{"status":"done"}`, 400},
		"position":          {`{"position":1}`, 400},
		"projectId":         {`{"projectId":"` + zeroUUID + `"}`, 400},
		"createdBy":         {`{"createdBy":"` + zeroUUID + `"}`, 400},
	}
	for name, tc := range bad {
		if got := e.status(alice, "PATCH", path, tc.body); got != tc.status {
			t.Errorf("%s: status = %d, want %d", name, got, tc.status)
		}
	}
}

func TestListFiltersAndSearch(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Board")
	e.addMember(alice, pid, bob)

	e.createTask(alice, pid, fmt.Sprintf(`{"title":"Fix login bug","priority":"high","assigneeId":%q}`, bob.id))
	e.createTask(alice, pid, `{"title":"Write docs","priority":"low"}`)
	e.createTask(alice, pid, `{"title":"100% done_ish","status":"done"}`)
	e.createTask(alice, pid, `{"title":"Deploy","status":"review","priority":"high"}`)

	cases := []struct {
		query string
		want  []string
	}{
		// Column order (todo, in_progress, review, done), then position inside each column.
		{"", []string{"Fix login bug", "Write docs", "Deploy", "100% done_ish"}},
		{"?status=todo", []string{"Fix login bug", "Write docs"}},
		{"?priority=high", []string{"Fix login bug", "Deploy"}},
		{"?assigneeId=" + bob.id, []string{"Fix login bug"}},
		{"?status=todo&priority=high", []string{"Fix login bug"}},
		{"?q=LOGIN", []string{"Fix login bug"}}, // case-insensitive
		{"?q=do", []string{"Write docs", "100% done_ish"}},
		{"?q=" + url.QueryEscape("%"), []string{"100% done_ish"}}, // wildcards are literal
		{"?q=" + url.QueryEscape("_"), []string{"100% done_ish"}},
		{"?q=" + url.QueryEscape("' OR '1'='1"), nil}, // injection is just text
		{"?q=nothing-matches", nil},
	}
	for _, c := range cases {
		if got := e.titles(alice, pid, c.query); !eq(got, c.want) {
			t.Errorf("%q = %v, want %v", c.query, got, c.want)
		}
	}

	for _, q := range []string{"status=bogus", "priority=x", "assigneeId=nope", "trashed=maybe", "page=abc", "pageSize=-1",
		"q=" + strings.Repeat("x", 101)} {
		if got := e.status(alice, "GET", "/api/v1/projects/"+pid+"/tasks?"+q, ""); got != 422 {
			t.Errorf("?%s = %d, want 422", q[:min(len(q), 30)], got)
		}
	}

	p1 := do(t, e.h, "GET", "/api/v1/projects/"+pid+"/tasks?pageSize=3&page=1", alice.token, "")
	p2 := do(t, e.h, "GET", "/api/v1/projects/"+pid+"/tasks?pageSize=3&page=2", alice.token, "")
	if p1.body["total"] != float64(4) || len(p1.body["items"].([]any)) != 3 || len(p2.body["items"].([]any)) != 1 {
		t.Errorf("pagination:\n%s\n%s", p1.raw, p2.raw)
	}
}

func TestMoveTasks(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	a := e.createTask(alice, pid, `{"title":"A"}`)
	b := e.createTask(alice, pid, `{"title":"B"}`)
	c := e.createTask(alice, pid, `{"title":"C"}`)
	mv := func(id, body string) resp { return do(t, e.h, "POST", "/api/v1/tasks/"+id+"/move", alice.token, body) }
	todo := func() []string { return e.titles(alice, pid, "?status=todo") }

	if r := mv(c, fmt.Sprintf(`{"status":"todo","beforeTaskId":%q}`, a)); r.code != 200 {
		t.Fatalf("move C before A: %d %s", r.code, r.raw)
	}
	if got := todo(); !eq(got, []string{"C", "A", "B"}) {
		t.Errorf("after C before A: %v", got)
	}

	// Move to the end of the same column (no beforeTaskId).
	mv(c, `{"status":"todo"}`)
	if got := todo(); !eq(got, []string{"A", "B", "C"}) {
		t.Errorf("after C to end: %v", got)
	}

	// Across columns: B goes to the empty "review" column, A to done, then C before B in review.
	if r := mv(b, `{"status":"review"}`); r.code != 200 || r.body["status"] != "review" {
		t.Errorf("move B to review: %d %s", r.code, r.raw)
	}
	mv(a, `{"status":"done"}`)
	mv(c, fmt.Sprintf(`{"status":"review","beforeTaskId":%q}`, b))
	if got := e.titles(alice, pid, "?status=review"); !eq(got, []string{"C", "B"}) {
		t.Errorf("review column = %v", got)
	}
	if got, want := todo(), []string(nil); !eq(got, want) {
		t.Errorf("todo should be empty, got %v", got)
	}

	// Bad requests.
	for name, tc := range map[string]struct{ body string }{
		"bad status":             {`{"status":"archived"}`},
		"empty status":           {`{}`},
		"before itself":          {fmt.Sprintf(`{"status":"review","beforeTaskId":%q}`, c)},
		"before not a uuid":      {`{"status":"review","beforeTaskId":"abc"}`},
		"before unknown task":    {`{"status":"review","beforeTaskId":"` + zeroUUID + `"}`},
		"before in wrong column": {fmt.Sprintf(`{"status":"review","beforeTaskId":%q}`, a)}, // A is in done
	} {
		if r := mv(c, tc.body); r.code != 422 {
			t.Errorf("%s: status = %d, want 422 (%s)", name, r.code, r.raw)
		}
	}
	if got := e.titles(alice, pid, "?status=review"); !eq(got, []string{"C", "B"}) {
		t.Errorf("failed moves changed the board: %v", got)
	}
}

// Positions are fractions. Squeezing a task in front of the first one again and again would run out of
// precision; the column must be renumbered so the order stays correct.
func TestMoveSurvivesManyInsertionsAtTheTop(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")

	first := e.createTask(alice, pid, `{"title":"first"}`)
	var ids []string
	for i := 0; i < 5; i++ {
		ids = append(ids, e.createTask(alice, pid, fmt.Sprintf(`{"title":"t%d"}`, i)))
	}

	// 80 times: take the last task and put it in front of the first. Halving 80 times would underflow
	// any gap, so this forces renumbering.
	want := append([]string{"first"}, "t0", "t1", "t2", "t3", "t4")
	cur := first
	for i := 0; i < 80; i++ {
		lastTitle := want[len(want)-1]
		var lastID string
		if lastTitle == "first" {
			lastID = first
		} else {
			lastID = ids[int(lastTitle[1]-'0')]
		}
		r := do(t, e.h, "POST", "/api/v1/tasks/"+lastID+"/move", alice.token,
			fmt.Sprintf(`{"status":"todo","beforeTaskId":%q}`, e.firstID(alice, pid)))
		if r.code != 200 {
			t.Fatalf("move #%d: %d %s", i, r.code, r.raw)
		}
		want = append([]string{lastTitle}, want[:len(want)-1]...)
		_ = cur
		if got := e.titles(alice, pid, "?status=todo"); !eq(got, want) {
			t.Fatalf("after move #%d: got %v, want %v", i, got, want)
		}
	}
}

// The risky case for fractional positions: squeezing tasks into the SAME gap again and again.
// After about 30 halvings the gap is too small to split, so the column has to be renumbered.
func TestMoveSurvivesManyInsertionsIntoTheSameGap(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")

	x := e.createTask(alice, pid, `{"title":"X"}`)
	y := e.createTask(alice, pid, `{"title":"Y"}`)
	const n = 70
	movers := make([]string, n)
	for i := range movers {
		movers[i] = e.createTask(alice, pid, fmt.Sprintf(`{"title":"m%02d"}`, i+1))
	}
	_ = x

	move := func(id, before string) {
		t.Helper()
		r := do(t, e.h, "POST", "/api/v1/tasks/"+id+"/move", alice.token,
			fmt.Sprintf(`{"status":"todo","beforeTaskId":%q}`, before))
		if r.code != 200 {
			t.Fatalf("move: %d %s", r.code, r.raw)
		}
	}

	// m01 goes before Y, then each next mover goes right before the previous one:
	// every insertion lands between X and the most recent mover, halving that gap each time.
	move(movers[0], y)
	for i := 1; i < n; i++ {
		move(movers[i], movers[i-1])
	}

	want := []string{"X"}
	for i := n; i >= 1; i-- {
		want = append(want, fmt.Sprintf("m%02d", i))
	}
	want = append(want, "Y")
	got := e.titles(alice, pid, "?status=todo&pageSize=100")
	if !eq(got, want) {
		t.Errorf("order wrong after %d insertions into one gap:\n got  %v\n want %v", n, got, want)
	}

	// Positions must all be distinct, otherwise the order only looks right by luck (ties broken by id).
	r := do(t, e.h, "GET", "/api/v1/projects/"+pid+"/tasks?status=todo&pageSize=100", alice.token, "")
	seen := map[float64]bool{}
	for _, it := range r.body["items"].([]any) {
		p := it.(map[string]any)["position"].(float64)
		if seen[p] {
			t.Fatalf("two tasks share position %v", p)
		}
		seen[p] = true
	}
}

func (e *env) firstID(u user, projectID string) string {
	e.t.Helper()
	r := do(e.t, e.h, "GET", "/api/v1/projects/"+projectID+"/tasks?status=todo&pageSize=1", u.token, "")
	return r.body["items"].([]any)[0].(map[string]any)["id"].(string)
}

func TestTaskTrashAndRestore(t *testing.T) {
	e := newEnv(t)
	alice, eve := e.newUser("alice"), e.newUser("eve")
	pid := e.createProject(alice, "Board")
	a := e.createTask(alice, pid, `{"title":"A"}`)
	b := e.createTask(alice, pid, `{"title":"B"}`)
	c := e.createTask(alice, pid, `{"title":"C"}`)
	posB := e.task(alice, b).body["position"]

	if got := e.status(alice, "DELETE", "/api/v1/tasks/"+b, ""); got != 204 {
		t.Fatalf("delete = %d", got)
	}
	// Hidden everywhere except the trash.
	if got := e.titles(alice, pid, ""); !eq(got, []string{"A", "C"}) {
		t.Errorf("board = %v", got)
	}
	for _, c := range []struct{ method, body string }{{"GET", ""}, {"PATCH", `{"title":"x"}`}, {"DELETE", ""}} {
		if got := e.status(alice, c.method, "/api/v1/tasks/"+b, c.body); got != 404 {
			t.Errorf("%s trashed task = %d, want 404", c.method, got)
		}
	}
	if got := e.status(alice, "POST", "/api/v1/tasks/"+b+"/move", `{"status":"done"}`); got != 404 {
		t.Errorf("move trashed task = %d, want 404", got)
	}

	tr := do(t, e.h, "GET", "/api/v1/projects/"+pid+"/tasks?trashed=true", alice.token, "")
	if tr.body["total"] != float64(1) {
		t.Fatalf("trash = %s", tr.raw)
	}
	item := tr.body["items"].([]any)[0].(map[string]any)
	purge, err := time.Parse(time.RFC3339Nano, item["purgeAt"].(string))
	if err != nil || purge.Sub(e.now.Add(30*24*time.Hour)).Abs() > time.Second {
		t.Errorf("purgeAt = %v (%v), want ~30 days after deletion", item["purgeAt"], err)
	}

	if got := e.status(eve, "POST", "/api/v1/tasks/"+b+"/restore", ""); got != 404 {
		t.Errorf("stranger restore = %d, want 404", got)
	}
	r := do(t, e.h, "POST", "/api/v1/tasks/"+b+"/restore", alice.token, "")
	if r.code != 200 || r.body["deletedAt"] != nil || r.body["position"] != posB {
		t.Errorf("restore = %d %s (position should be %v)", r.code, r.raw, posB)
	}
	if got := e.titles(alice, pid, ""); !eq(got, []string{"A", "B", "C"}) {
		t.Errorf("order after restore = %v", got)
	}
	if got := e.status(alice, "POST", "/api/v1/tasks/"+b+"/restore", ""); got != 404 {
		t.Errorf("restoring an active task = %d, want 404", got)
	}
	_, _ = a, c
}

func TestTaskRestoreExpires(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tid := e.createTask(alice, pid, `{"title":"Old"}`)
	e.status(alice, "DELETE", "/api/v1/tasks/"+tid, "")

	e.now = e.now.Add(29 * 24 * time.Hour)
	if r := do(t, e.h, "GET", "/api/v1/projects/"+pid+"/tasks?trashed=true", alice.token, ""); r.body["total"] != float64(1) {
		t.Errorf("day 29: should still be in trash: %s", r.raw)
	}
	e.now = e.now.Add(2 * 24 * time.Hour)
	if r := do(t, e.h, "GET", "/api/v1/projects/"+pid+"/tasks?trashed=true", alice.token, ""); r.body["total"] != float64(0) {
		t.Errorf("day 31: expired task still listed: %s", r.raw)
	}
	if got := e.status(alice, "POST", "/api/v1/tasks/"+tid+"/restore", ""); got != 404 {
		t.Errorf("day 31 restore = %d, want 404", got)
	}
}

func TestRemovingMemberUnassignsTheirTasks(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Board")
	e.addMember(alice, pid, bob)
	active := e.createTask(alice, pid, fmt.Sprintf(`{"title":"active","assigneeId":%q}`, bob.id))
	trashed := e.createTask(alice, pid, fmt.Sprintf(`{"title":"trashed","assigneeId":%q}`, bob.id))
	e.status(alice, "DELETE", "/api/v1/tasks/"+trashed, "")

	if got := e.status(alice, "DELETE", "/api/v1/projects/"+pid+"/members/"+bob.id, ""); got != 204 {
		t.Fatalf("remove member = %d", got)
	}
	if r := e.task(alice, active); r.code != 200 || r.body["assigneeId"] != nil {
		t.Errorf("active task still assigned to removed member: %s", r.raw)
	}
	// A trashed task is also unassigned, so restoring it never resurrects a stale assignee.
	r := do(t, e.h, "POST", "/api/v1/tasks/"+trashed+"/restore", alice.token, "")
	if r.code != 200 || r.body["assigneeId"] != nil {
		t.Errorf("restored task still assigned to removed member: %d %s", r.code, r.raw)
	}
	// And the removed member can no longer see anything.
	if got := e.status(bob, "GET", "/api/v1/tasks/"+active, ""); got != 404 {
		t.Errorf("removed member can read a task: %d", got)
	}
}

func TestTasksFollowProjectTrash(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Doomed")
	tid := e.createTask(alice, pid, `{"title":"Inside"}`)

	e.status(alice, "DELETE", "/api/v1/projects/"+pid, "")
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/api/v1/projects/" + pid + "/tasks", ""},
		{"POST", "/api/v1/projects/" + pid + "/tasks", `{"title":"new"}`},
		{"GET", "/api/v1/tasks/" + tid, ""},
		{"PATCH", "/api/v1/tasks/" + tid, `{"title":"x"}`},
		{"POST", "/api/v1/tasks/" + tid + "/move", `{"status":"done"}`},
	} {
		if got := e.status(alice, c.method, c.path, c.body); got != 404 {
			t.Errorf("%s %s while project is trashed = %d, want 404", c.method, c.path, got)
		}
	}

	e.status(alice, "POST", "/api/v1/projects/"+pid+"/restore", "")
	if r := e.task(alice, tid); r.code != 200 || r.body["title"] != "Inside" {
		t.Errorf("task lost after project restore: %d %s", r.code, r.raw)
	}
}

func TestTaskIDsAreValidated(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	for _, id := range []string{"not-a-uuid", "123", "'; DROP TABLE tasks;--"} {
		p := "/api/v1/tasks/" + url.PathEscape(id)
		if got := e.status(alice, "GET", p, ""); got != 404 {
			t.Errorf("GET %s = %d, want 404", p, got)
		}
	}
	if got := e.status(alice, "GET", "/api/v1/projects", ""); got != http.StatusOK {
		t.Errorf("service unhealthy after injection attempts: %d", got)
	}
}
