package router

import (
	"fmt"
	"slices"
	"testing"
)

// assignees returns the task's assignee ids, sorted. A null in the JSON would come back as nil.
func assignees(r resp) []string {
	raw, ok := r.body["assigneeIds"].([]any)
	if !ok {
		return nil
	}
	ids := make([]string, 0, len(raw))
	for _, id := range raw {
		ids = append(ids, id.(string))
	}
	slices.Sort(ids)
	return ids
}

func sortedIDs(ids ...string) []string {
	slices.Sort(ids)
	return ids
}

func TestTaskHasSeveralAssignees(t *testing.T) {
	e := newEnv(t)
	alice, bob, carol := e.newUser("alice"), e.newUser("bob"), e.newUser("carol")
	pid := e.createProject(alice, "Team")
	e.addMember(alice, pid, bob)
	e.addMember(alice, pid, carol)

	// Created with two people, one of them sent twice: the answer shows them once each.
	r := do(t, e.h, "POST", "/api/v1/projects/"+pid+"/tasks", alice.token,
		fmt.Sprintf(`{"title":"Shared","assigneeIds":[%q,%q,%q]}`, bob.id, alice.id, bob.id))
	if r.code != 201 || !eq(assignees(r), sortedIDs(alice.id, bob.id)) {
		t.Fatalf("create = %d %s", r.code, r.raw)
	}
	tid := r.body["id"].(string)
	path := "/api/v1/tasks/" + tid

	if got := assignees(e.task(alice, tid)); !eq(got, sortedIDs(alice.id, bob.id)) {
		t.Errorf("read back = %v", got)
	}

	// The filter finds the task under each of its people, and only theirs.
	if got := e.titles(alice, pid, "?assigneeId="+bob.id); !eq(got, []string{"Shared"}) {
		t.Errorf("filter bob = %v", got)
	}
	if got := e.titles(alice, pid, "?assigneeId="+alice.id); !eq(got, []string{"Shared"}) {
		t.Errorf("filter alice = %v", got)
	}
	if got := e.titles(alice, pid, "?assigneeId="+carol.id); len(got) != 0 {
		t.Errorf("filter carol = %v", got)
	}

	// A patch replaces the whole list: one stays, one goes, one arrives.
	r = do(t, e.h, "PATCH", path, alice.token, fmt.Sprintf(`{"assigneeIds":[%q,%q]}`, bob.id, carol.id))
	if r.code != 200 || !eq(assignees(r), sortedIDs(bob.id, carol.id)) {
		t.Errorf("replace = %d %s", r.code, r.raw)
	}

	// A patch without the list leaves it alone.
	r = do(t, e.h, "PATCH", path, alice.token, `{"title":"Renamed"}`)
	if r.code != 200 || !eq(assignees(r), sortedIDs(bob.id, carol.id)) {
		t.Errorf("absent list changed the assignees: %s", r.raw)
	}

	// A refused list changes nothing, not even the valid people in it.
	if got := e.status(alice, "PATCH", path, fmt.Sprintf(`{"assigneeIds":[%q,%q]}`, alice.id, zeroUUID)); got != 422 {
		t.Errorf("stranger in the list = %d, want 422", got)
	}
	if got := assignees(e.task(alice, tid)); !eq(got, sortedIDs(bob.id, carol.id)) {
		t.Errorf("refused patch changed the assignees: %v", got)
	}

	// An empty list clears them, and comes back as a list rather than null.
	r = do(t, e.h, "PATCH", path, alice.token, `{"assigneeIds":[]}`)
	if r.code != 200 || assignees(r) == nil || len(assignees(r)) != 0 {
		t.Errorf("clear = %d %s", r.code, r.raw)
	}
}

func TestRemovingMemberKeepsTheOtherAssignees(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Team")
	e.addMember(alice, pid, bob)
	tid := e.createTask(alice, pid, fmt.Sprintf(`{"title":"Shared","assigneeIds":[%q,%q]}`, alice.id, bob.id))

	if got := e.status(alice, "DELETE", "/api/v1/projects/"+pid+"/members/"+bob.id, ""); got != 204 {
		t.Fatalf("remove member = %d", got)
	}
	if got := assignees(e.task(alice, tid)); !eq(got, []string{alice.id}) {
		t.Errorf("assignees after removal = %v, want only alice", got)
	}
}

func TestTaskStartAndEndDates(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	pid := e.createProject(alice, "Board")
	tasks := "/api/v1/projects/" + pid + "/tasks"

	r := do(t, e.h, "POST", tasks, alice.token, `{"title":"Dated","startDate":"2026-12-01","dueDate":"2026-12-31"}`)
	if r.code != 201 || r.body["startDate"] != "2026-12-01" || r.body["dueDate"] != "2026-12-31" {
		t.Fatalf("create = %d %s", r.code, r.raw)
	}
	path := "/api/v1/tasks/" + r.body["id"].(string)

	created := map[string]struct {
		body   string
		status int
	}{
		"start only":       {`{"title":"t","startDate":"2026-12-01"}`, 201},
		"end only":         {`{"title":"t","dueDate":"2026-12-01"}`, 201},
		"one day":          {`{"title":"t","startDate":"2026-12-01","dueDate":"2026-12-01"}`, 201},
		"end before start": {`{"title":"t","startDate":"2026-12-02","dueDate":"2026-12-01"}`, 422},
		"start not a date": {`{"title":"t","startDate":"soon"}`, 422},
		"start impossible": {`{"title":"t","startDate":"2026-02-30"}`, 422},
	}
	for name, tc := range created {
		if got := e.status(alice, "POST", tasks, tc.body); got != tc.status {
			t.Errorf("create %s: status = %d, want %d", name, got, tc.status)
		}
	}

	// A change to one date is checked against the other date already on the task.
	updated := map[string]struct {
		body   string
		status int
	}{
		"start after stored end":  {`{"startDate":"2027-01-01"}`, 422},
		"end before stored start": {`{"dueDate":"2026-11-30"}`, 422},
		"both moved together":     {`{"startDate":"2027-01-01","dueDate":"2027-01-31"}`, 200},
	}
	for _, name := range []string{"start after stored end", "end before stored start", "both moved together"} {
		if got := e.status(alice, "PATCH", path, updated[name].body); got != updated[name].status {
			t.Errorf("patch %s: status = %d, want %d", name, got, updated[name].status)
		}
	}

	// Each date clears on its own, and a cleared date no longer limits the other.
	r = do(t, e.h, "PATCH", path, alice.token, `{"startDate":null}`)
	if r.code != 200 || r.body["startDate"] != nil || r.body["dueDate"] != "2027-01-31" {
		t.Errorf("clear start = %d %s", r.code, r.raw)
	}
	r = do(t, e.h, "PATCH", path, alice.token, `{"dueDate":"2020-01-01"}`)
	if r.code != 200 || r.body["dueDate"] != "2020-01-01" {
		t.Errorf("end with no start = %d %s", r.code, r.raw)
	}
}
