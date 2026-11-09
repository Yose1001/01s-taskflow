package router

import (
	"strings"
	"testing"
)

func TestMovingATaskOnHoldNeedsAReason(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tid := e.createTask(alice, pid, `{"title":"Backend","status":"in_progress"}`)
	move := "/api/v1/tasks/" + tid + "/move"

	if r := e.task(alice, tid); r.body["holdReason"] != nil {
		t.Errorf("a new task should have no reason: %s", r.raw)
	}

	bad := map[string]string{
		"no reason":    `{"status":"on_hold"}`,
		"null reason":  `{"status":"on_hold","holdReason":null}`,
		"blank reason": `{"status":"on_hold","holdReason":"   "}`,
		"too long":     `{"status":"on_hold","holdReason":"` + strings.Repeat("ก", 501) + `"}`,
	}
	for name, body := range bad {
		if got := e.status(alice, "POST", move, body); got != 422 {
			t.Errorf("%s: status = %d, want 422", name, got)
		}
	}
	if r := e.task(alice, tid); r.body["status"] != "in_progress" {
		t.Errorf("a refused move changed the column: %s", r.raw)
	}

	r := do(t, e.h, "POST", move, alice.token, `{"status":"on_hold","holdReason":"  รอ API จากทีมอื่น  "}`)
	if r.code != 200 || r.body["status"] != "on_hold" || r.body["holdReason"] != "รอ API จากทีมอื่น" {
		t.Fatalf("hold = %d %s", r.code, r.raw)
	}
	if got := e.titles(alice, pid, "?status=on_hold"); !eq(got, []string{"Backend"}) {
		t.Errorf("on_hold column = %v", got)
	}

	// Exactly 500 characters is fine, counted as letters and not bytes.
	long := strings.Repeat("ก", 500)
	if got := e.status(alice, "POST", move, `{"status":"on_hold","holdReason":"`+long+`"}`); got != 200 {
		t.Errorf("500 letters = %d, want 200", got)
	}
}

func TestReorderingInsideOnHoldKeepsTheReason(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	first := e.createTask(alice, pid, `{"title":"First","status":"on_hold","holdReason":"reason one"}`)
	second := e.createTask(alice, pid, `{"title":"Second","status":"on_hold","holdReason":"reason two"}`)

	r := do(t, e.h, "POST", "/api/v1/tasks/"+second+"/move", alice.token, `{"status":"on_hold","beforeTaskId":"`+first+`"}`)
	if r.code != 200 || r.body["holdReason"] != "reason two" {
		t.Fatalf("reorder = %d %s", r.code, r.raw)
	}
	if got := e.titles(alice, pid, "?status=on_hold"); !eq(got, []string{"Second", "First"}) {
		t.Errorf("order = %v", got)
	}
}

func TestLeavingOnHoldClearsTheReason(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tid := e.createTask(alice, pid, `{"title":"Paused","status":"on_hold","holdReason":"waiting"}`)
	move := "/api/v1/tasks/" + tid + "/move"

	r := do(t, e.h, "POST", move, alice.token, `{"status":"in_progress"}`)
	if r.code != 200 || r.body["status"] != "in_progress" || r.body["holdReason"] != nil {
		t.Errorf("leave = %d %s", r.code, r.raw)
	}
	// A reason sent with another column means nothing, and is not kept.
	r = do(t, e.h, "POST", move, alice.token, `{"status":"done","holdReason":"ignored"}`)
	if r.code != 200 || r.body["holdReason"] != nil {
		t.Errorf("reason with another column = %d %s", r.code, r.raw)
	}
	// Going back on hold asks again: the old reason is gone.
	if got := e.status(alice, "POST", move, `{"status":"on_hold"}`); got != 422 {
		t.Errorf("hold again without a reason = %d, want 422", got)
	}
}

func TestCreatingATaskOnHold(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tasks := "/api/v1/projects/" + pid + "/tasks"

	if got := e.status(alice, "POST", tasks, `{"title":"t","status":"on_hold"}`); got != 422 {
		t.Errorf("no reason = %d, want 422", got)
	}
	if got := e.status(alice, "POST", tasks, `{"title":"t","status":"on_hold","holdReason":" "}`); got != 422 {
		t.Errorf("blank reason = %d, want 422", got)
	}
	r := do(t, e.h, "POST", tasks, alice.token, `{"title":"t","status":"on_hold","holdReason":" waiting "}`)
	if r.code != 201 || r.body["status"] != "on_hold" || r.body["holdReason"] != "waiting" {
		t.Errorf("create = %d %s", r.code, r.raw)
	}
	r = do(t, e.h, "POST", tasks, alice.token, `{"title":"t","holdReason":"not on hold"}`)
	if r.code != 201 || r.body["holdReason"] != nil {
		t.Errorf("reason on a task not on hold = %d %s", r.code, r.raw)
	}
}

func TestEditingTheHoldReason(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	held := e.createTask(alice, pid, `{"title":"Paused","status":"on_hold","holdReason":"waiting"}`)
	active := e.createTask(alice, pid, `{"title":"Active"}`)

	r := do(t, e.h, "PATCH", "/api/v1/tasks/"+held, alice.token, `{"holdReason":" still waiting "}`)
	if r.code != 200 || r.body["holdReason"] != "still waiting" {
		t.Errorf("edit = %d %s", r.code, r.raw)
	}
	r = do(t, e.h, "PATCH", "/api/v1/tasks/"+held, alice.token, `{"title":"Renamed"}`)
	if r.code != 200 || r.body["holdReason"] != "still waiting" {
		t.Errorf("an unrelated edit changed the reason: %d %s", r.code, r.raw)
	}
	for name, c := range map[string]struct{ id, body string }{
		"blank":       {held, `{"holdReason":"  "}`},
		"too long":    {held, `{"holdReason":"` + strings.Repeat("x", 501) + `"}`},
		"not on hold": {active, `{"holdReason":"nope"}`},
	} {
		if got := e.status(alice, "PATCH", "/api/v1/tasks/"+c.id, c.body); got != 422 {
			t.Errorf("%s: status = %d, want 422", name, got)
		}
	}
}

func TestOnHoldSitsBetweenReviewAndDone(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	e.createTask(alice, pid, `{"title":"Finished","status":"done"}`)
	e.createTask(alice, pid, `{"title":"Paused","status":"on_hold","holdReason":"waiting"}`)
	e.createTask(alice, pid, `{"title":"Checking","status":"review"}`)

	if got := e.titles(alice, pid, ""); !eq(got, []string{"Checking", "Paused", "Finished"}) {
		t.Errorf("board order = %v", got)
	}
}

func TestOnHoldSurvivesTheTrash(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tid := e.createTask(alice, pid, `{"title":"Paused","status":"on_hold","holdReason":"waiting"}`)

	e.status(alice, "DELETE", "/api/v1/tasks/"+tid, "")
	r := do(t, e.h, "POST", "/api/v1/tasks/"+tid+"/restore", alice.token, "")
	if r.code != 200 || r.body["status"] != "on_hold" || r.body["holdReason"] != "waiting" {
		t.Errorf("restore = %d %s", r.code, r.raw)
	}
}
