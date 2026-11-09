package router

import (
	"fmt"
	"strings"
	"testing"
)

type subtaskView struct {
	id, title string
	done      bool
}

// subtasksOf returns the task's subtasks in order. A null in the JSON would come back as nil.
func subtasksOf(r resp) []subtaskView {
	raw, ok := r.body["subtasks"].([]any)
	if !ok {
		return nil
	}
	items := make([]subtaskView, 0, len(raw))
	for _, item := range raw {
		s := item.(map[string]any)
		items = append(items, subtaskView{id: s["id"].(string), title: s["title"].(string), done: s["done"].(bool)})
	}
	return items
}

func subtaskTitles(r resp) []string {
	titles := []string{}
	for _, s := range subtasksOf(r) {
		titles = append(titles, s.title)
	}
	return titles
}

func TestTaskHasNoSubtasksByDefault(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	r := e.task(alice, e.createTask(alice, pid, `{"title":"Plain"}`))
	if got := subtasksOf(r); got == nil || len(got) != 0 {
		t.Errorf("subtasks should be an empty list, not null: %s", r.raw)
	}
}

func TestCreateTaskWithSubtasks(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tasks := "/api/v1/projects/" + pid + "/tasks"

	r := do(t, e.h, "POST", tasks, alice.token, `{"title":"Backend","subtasks":[" API เส้น 1 ","API เส้น 2","API เส้น 3"]}`)
	if r.code != 201 || !eq(subtaskTitles(r), []string{"API เส้น 1", "API เส้น 2", "API เส้น 3"}) {
		t.Fatalf("create = %d %s", r.code, r.raw)
	}
	for _, s := range subtasksOf(r) {
		if s.done {
			t.Errorf("a new subtask should not be done: %s", r.raw)
		}
	}
	// The answer to the create and a later read agree, in the same order.
	if got := subtaskTitles(e.task(alice, r.body["id"].(string))); !eq(got, []string{"API เส้น 1", "API เส้น 2", "API เส้น 3"}) {
		t.Errorf("read back = %v", got)
	}
	// So does the list the board reads.
	list := do(t, e.h, "GET", tasks, alice.token, "")
	first := list.body["items"].([]any)[0].(map[string]any)
	if got := first["subtasks"].([]any); len(got) != 3 {
		t.Errorf("listing has %d subtasks, want 3: %s", len(got), list.raw)
	}

	tooMany := `["` + strings.Repeat(`x","`, 100) + `x"]`
	bad := map[string]string{
		"blank":    `{"title":"t","subtasks":["  "]}`,
		"too long": `{"title":"t","subtasks":["` + strings.Repeat("x", 201) + `"]}`,
		"control":  `{"title":"t","subtasks":["a\u0000b"]}`,
		"too many": `{"title":"t","subtasks":` + tooMany + `}`,
	}
	for name, body := range bad {
		if got := e.status(alice, "POST", tasks, body); got != 422 {
			t.Errorf("%s: status = %d, want 422", name, got)
		}
	}
	if got := e.status(alice, "POST", tasks, `{"title":"t","subtasks":"not a list"}`); got != 400 {
		t.Errorf("not a list: status = %d, want 400", got)
	}
}

func TestSubtaskLifecycle(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Team")
	e.addMember(alice, pid, bob)
	tid := e.createTask(alice, pid, `{"title":"Backend"}`)
	path := "/api/v1/tasks/" + tid + "/subtasks"

	add := func(title string) string {
		t.Helper()
		r := do(t, e.h, "POST", path, alice.token, fmt.Sprintf(`{"title":%q}`, title))
		if r.code != 201 || r.body["title"] != strings.TrimSpace(title) || r.body["done"] != false {
			t.Fatalf("add %q = %d %s", title, r.code, r.raw)
		}
		return r.body["id"].(string)
	}
	one, two := add("  API เส้น 1 "), add("API เส้น 2")
	if got := subtaskTitles(e.task(alice, tid)); !eq(got, []string{"API เส้น 1", "API เส้น 2"}) {
		t.Fatalf("new subtasks go last, got %v", got)
	}

	// Any member can tick one off, and only that one changes.
	r := do(t, e.h, "PATCH", path+"/"+one, bob.token, `{"done":true}`)
	if r.code != 200 || r.body["done"] != true || r.body["title"] != "API เส้น 1" {
		t.Errorf("tick = %d %s", r.code, r.raw)
	}
	items := subtasksOf(e.task(alice, tid))
	if !items[0].done || items[1].done {
		t.Errorf("after the tick: %+v", items)
	}

	// Rename leaves the tick alone, and the order too.
	r = do(t, e.h, "PATCH", path+"/"+one, alice.token, `{"title":" GET /users "}`)
	if r.code != 200 || r.body["title"] != "GET /users" || r.body["done"] != true {
		t.Errorf("rename = %d %s", r.code, r.raw)
	}
	if got := subtaskTitles(e.task(alice, tid)); !eq(got, []string{"GET /users", "API เส้น 2"}) {
		t.Errorf("order after the rename = %v", got)
	}
	// And it can be un-ticked.
	if r := do(t, e.h, "PATCH", path+"/"+one, alice.token, `{"done":false}`); r.code != 200 || r.body["done"] != false {
		t.Errorf("untick = %d %s", r.code, r.raw)
	}

	bad := map[string]struct {
		method, url, body string
		status            int
	}{
		"add blank":       {"POST", path, `{"title":"  "}`, 422},
		"add too long":    {"POST", path, `{"title":"` + strings.Repeat("x", 201) + `"}`, 422},
		"empty patch":     {"PATCH", path + "/" + one, `{}`, 422},
		"rename blank":    {"PATCH", path + "/" + one, `{"title":" "}`, 422},
		"unknown field":   {"PATCH", path + "/" + one, `{"position":1}`, 400},
		"not a uuid":      {"PATCH", path + "/nope", `{"done":true}`, 404},
		"unknown subtask": {"PATCH", path + "/" + zeroUUID, `{"done":true}`, 404},
		"delete not uuid": {"DELETE", path + "/nope", "", 404},
		"delete unknown":  {"DELETE", path + "/" + zeroUUID, "", 404},
		"add to no task":  {"POST", "/api/v1/tasks/" + zeroUUID + "/subtasks", `{"title":"x"}`, 404},
		"add bad task id": {"POST", "/api/v1/tasks/nope/subtasks", `{"title":"x"}`, 404},
	}
	for name, c := range bad {
		if got := e.status(alice, c.method, c.url, c.body); got != c.status {
			t.Errorf("%s: status = %d, want %d", name, got, c.status)
		}
	}

	if got := e.status(alice, "DELETE", path+"/"+two, ""); got != 204 {
		t.Errorf("delete = %d", got)
	}
	if got := subtaskTitles(e.task(alice, tid)); !eq(got, []string{"GET /users"}) {
		t.Errorf("after the delete = %v", got)
	}
	if got := e.status(alice, "DELETE", path+"/"+two, ""); got != 404 {
		t.Errorf("deleting twice = %d, want 404", got)
	}
}

func TestSubtasksBelongToTheirTask(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	mine := e.createTask(alice, pid, `{"title":"Mine","subtasks":["keep me"]}`)
	other := e.createTask(alice, pid, `{"title":"Other"}`)
	sub := subtasksOf(e.task(alice, mine))[0].id

	// A subtask cannot be reached through a different task, even in the same project.
	wrong := "/api/v1/tasks/" + other + "/subtasks/" + sub
	if got := e.status(alice, "PATCH", wrong, `{"done":true}`); got != 404 {
		t.Errorf("patch through another task = %d, want 404", got)
	}
	if got := e.status(alice, "DELETE", wrong, ""); got != 404 {
		t.Errorf("delete through another task = %d, want 404", got)
	}
	if got := subtasksOf(e.task(alice, mine)); len(got) != 1 || got[0].done {
		t.Errorf("the subtask changed: %+v", got)
	}
}

func TestStrangersCannotTouchSubtasks(t *testing.T) {
	e := newEnv(t)
	alice, mallory := e.newUser("alice"), e.newUser("mallory")
	pid := e.createProject(alice, "Private")
	tid := e.createTask(alice, pid, `{"title":"Secret","subtasks":["hidden"]}`)
	sub := subtasksOf(e.task(alice, tid))[0].id
	base := "/api/v1/tasks/" + tid + "/subtasks"

	for _, c := range []struct{ method, url, body string }{
		{"POST", base, `{"title":"x"}`},
		{"PATCH", base + "/" + sub, `{"done":true}`},
		{"DELETE", base + "/" + sub, ""},
	} {
		if got := e.status(mallory, c.method, c.url, c.body); got != 404 {
			t.Errorf("stranger %s = %d, want 404", c.method, got)
		}
		if r := do(t, e.h, c.method, c.url, "", c.body); r.code != 401 {
			t.Errorf("no login %s = %d, want 401", c.method, r.code)
		}
	}
	if got := subtasksOf(e.task(alice, tid)); len(got) != 1 || got[0].done || got[0].title != "hidden" {
		t.Errorf("a stranger changed it: %+v", got)
	}
}

func TestSubtasksFollowTheirTaskIntoTheTrash(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tid := e.createTask(alice, pid, `{"title":"Backend","subtasks":["one"]}`)
	sub := subtasksOf(e.task(alice, tid))[0].id
	base := "/api/v1/tasks/" + tid + "/subtasks"
	e.status(alice, "PATCH", base+"/"+sub, `{"done":true}`)

	e.status(alice, "DELETE", "/api/v1/tasks/"+tid, "")
	if got := e.status(alice, "POST", base, `{"title":"x"}`); got != 404 {
		t.Errorf("add to a trashed task = %d, want 404", got)
	}
	if got := e.status(alice, "PATCH", base+"/"+sub, `{"done":false}`); got != 404 {
		t.Errorf("tick on a trashed task = %d, want 404", got)
	}

	// They come back with it, exactly as they were.
	r := do(t, e.h, "POST", "/api/v1/tasks/"+tid+"/restore", alice.token, "")
	if got := subtasksOf(r); r.code != 200 || len(got) != 1 || !got[0].done {
		t.Errorf("restore = %d %s", r.code, r.raw)
	}
}

func TestTaskSubtaskLimit(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	full := `["` + strings.Repeat(`x","`, 99) + `x"]`
	tid := e.createTask(alice, pid, `{"title":"Full","subtasks":`+full+`}`)

	if got := e.status(alice, "POST", "/api/v1/tasks/"+tid+"/subtasks", `{"title":"one more"}`); got != 422 {
		t.Errorf("subtask 101 = %d, want 422", got)
	}
}
