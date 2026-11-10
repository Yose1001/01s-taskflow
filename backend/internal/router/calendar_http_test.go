package router

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// createEvent adds an important day and returns its id.
func (e *env) createEvent(u user, body string) string {
	e.t.Helper()
	r := do(e.t, e.h, "POST", "/api/v1/events", u.token, body)
	if r.code != 201 {
		e.t.Fatalf("create event = %d %s", r.code, r.raw)
	}
	return r.body["id"].(string)
}

// calendar returns the titles of the important days and the tasks u sees in the range.
func (e *env) calendar(u user, from, to string) (events, tasks []string) {
	e.t.Helper()
	r := do(e.t, e.h, "GET", "/api/v1/calendar?from="+from+"&to="+to, u.token, "")
	if r.code != 200 {
		e.t.Fatalf("calendar = %d %s", r.code, r.raw)
	}
	for _, it := range r.body["events"].([]any) {
		events = append(events, it.(map[string]any)["title"].(string))
	}
	for _, it := range r.body["tasks"].([]any) {
		tasks = append(tasks, it.(map[string]any)["title"].(string))
	}
	return events, tasks
}

// remindAt runs the reminder job as if it were the given Thai time ("2030-05-09 08:00"), and returns
// how many reminders it made.
func (e *env) remindAt(thai string) int64 {
	e.t.Helper()
	bangkok := time.FixedZone("ICT", 7*60*60)
	at, err := time.ParseInLocation("2006-01-02 15:04", thai, bangkok)
	if err != nil {
		e.t.Fatal(err)
	}
	made, err := e.events.GenerateReminders(context.Background(), at, "Asia/Bangkok", "08:00")
	if err != nil {
		e.t.Fatal(err)
	}
	return made
}

// inbox returns u's reminders as "title/daysBefore" and the unread count.
func (e *env) inbox(u user) ([]string, float64) {
	e.t.Helper()
	r := do(e.t, e.h, "GET", "/api/v1/notifications", u.token, "")
	if r.code != 200 {
		e.t.Fatalf("notifications = %d %s", r.code, r.raw)
	}
	var out []string
	for _, it := range r.body["items"].([]any) {
		n := it.(map[string]any)
		out = append(out, fmt.Sprintf("%s/%v", n["title"], n["daysBefore"]))
	}
	return out, r.body["unread"].(float64)
}

func TestCalendarRoutesRequireLogin(t *testing.T) {
	e := newEnv(t)
	id := "00000000-0000-0000-0000-000000000001"
	for _, rt := range [][2]string{
		{"GET", "/api/v1/calendar?from=2030-01-01&to=2030-01-31"}, {"POST", "/api/v1/events"},
		{"PATCH", "/api/v1/events/" + id}, {"DELETE", "/api/v1/events/" + id},
		{"GET", "/api/v1/notifications"}, {"POST", "/api/v1/notifications/read"},
	} {
		if r := do(t, e.h, rt[0], rt[1], "", `{}`); r.code != 401 {
			t.Errorf("%s %s without token = %d, want 401", rt[0], rt[1], r.code)
		}
	}
}

func TestImportantDaysAreSeenByTheRightPeople(t *testing.T) {
	e := newEnv(t)
	alice, bob, carol := e.newUser("alice"), e.newUser("bob"), e.newUser("carol")
	pid := e.createProject(alice, "Launch")
	e.addMember(alice, pid, bob)

	e.createEvent(alice, `{"title":"Alice's birthday","day":"2030-05-10"}`)
	r := do(t, e.h, "POST", "/api/v1/events", alice.token,
		`{"title":"  Client demo  ","note":" bring slides ","day":"2030-05-12","projectId":"`+pid+`","remindDays":[1,0,1]}`)
	if r.code != 201 || r.body["title"] != "Client demo" || r.body["note"] != "bring slides" ||
		r.body["projectName"] != "Launch" || r.body["canEdit"] != true {
		t.Fatalf("create project day = %d %s", r.code, r.raw)
	}
	if got := r.body["remindDays"].([]any); len(got) != 2 || got[0].(float64) != 0 || got[1].(float64) != 1 {
		t.Errorf("remind days should be sorted without repeats: %v", got)
	}

	if ev, _ := e.calendar(alice, "2030-05-01", "2030-05-31"); !eq(ev, []string{"Alice's birthday", "Client demo"}) {
		t.Errorf("alice sees %v", ev)
	}
	if ev, _ := e.calendar(bob, "2030-05-01", "2030-05-31"); !eq(ev, []string{"Client demo"}) {
		t.Errorf("bob (member) sees %v", ev)
	}
	if ev, _ := e.calendar(carol, "2030-05-01", "2030-05-31"); len(ev) != 0 {
		t.Errorf("carol (not a member) sees %v", ev)
	}
	if ev, _ := e.calendar(alice, "2030-05-11", "2030-05-11"); len(ev) != 0 {
		t.Errorf("a range with no days shows %v", ev)
	}
	// Somebody else's project is not a place to put a day.
	if got := e.status(carol, "POST", "/api/v1/events", `{"title":"x","day":"2030-05-01","projectId":"`+pid+`"}`); got != 422 {
		t.Errorf("day in someone else's project = %d, want 422", got)
	}
}

func TestWhoMayChangeAnImportantDay(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Launch")
	e.addMember(alice, pid, bob)

	private := e.createEvent(alice, `{"title":"Private","day":"2030-05-10"}`)
	byAlice := e.createEvent(alice, `{"title":"By Alice","day":"2030-05-10","projectId":"`+pid+`"}`)
	byBob := e.createEvent(bob, `{"title":"By Bob","day":"2030-05-11","projectId":"`+pid+`"}`)

	// Bob cannot even see Alice's own day, and may not change Alice's project day.
	if got := e.status(bob, "PATCH", "/api/v1/events/"+private, `{"title":"x"}`); got != 404 {
		t.Errorf("bob edits alice's own day = %d, want 404", got)
	}
	if got := e.status(bob, "PATCH", "/api/v1/events/"+byAlice, `{"title":"x"}`); got != 403 {
		t.Errorf("bob edits alice's project day = %d, want 403", got)
	}
	if got := e.status(bob, "DELETE", "/api/v1/events/"+byAlice, ""); got != 403 {
		t.Errorf("bob removes alice's project day = %d, want 403", got)
	}
	// Bob may change his own; Alice owns the project, so she may change Bob's too.
	if r := do(t, e.h, "PATCH", "/api/v1/events/"+byBob, bob.token, `{"title":"Bob renamed"}`); r.code != 200 || r.body["title"] != "Bob renamed" {
		t.Errorf("bob edits his day = %d %s", r.code, r.raw)
	}
	if r := do(t, e.h, "PATCH", "/api/v1/events/"+byBob, alice.token, `{"day":"2030-05-20","remindDays":[7]}`); r.code != 200 || r.body["day"] != "2030-05-20" {
		t.Errorf("owner edits bob's day = %d %s", r.code, r.raw)
	}
	if got := e.status(alice, "DELETE", "/api/v1/events/"+byBob, ""); got != 204 {
		t.Errorf("owner removes bob's day = %d, want 204", got)
	}
	if got := e.status(alice, "PATCH", "/api/v1/events/"+byBob, `{"title":"x"}`); got != 404 {
		t.Errorf("a removed day = %d, want 404", got)
	}
}

func TestImportantDayChecks(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	bad := map[string]string{
		"no title":      `{"day":"2030-05-10"}`,
		"blank title":   `{"title":"   ","day":"2030-05-10"}`,
		"long title":    `{"title":"` + strings.Repeat("ก", 121) + `","day":"2030-05-10"}`,
		"long note":     `{"title":"x","note":"` + strings.Repeat("x", 1001) + `","day":"2030-05-10"}`,
		"no day":        `{"title":"x"}`,
		"bad day":       `{"title":"x","day":"2030-02-30"}`,
		"odd reminder":  `{"title":"x","day":"2030-05-10","remindDays":[2]}`,
		"bad project":   `{"title":"x","day":"2030-05-10","projectId":"nope"}`,
		"unknown field": `{"title":"x","day":"2030-05-10","colour":"red"}`,
	}
	for name, body := range bad {
		if got := e.status(alice, "POST", "/api/v1/events", body); got != 422 && got != 400 {
			t.Errorf("%s: status = %d, want 422 (or 400 for a malformed body)", name, got)
		}
	}
	if got := e.status(alice, "POST", "/api/v1/events", `{"title":"`+strings.Repeat("ก", 120)+`","day":"2030-05-10"}`); got != 201 {
		t.Errorf("120 letters = %d, want 201", got)
	}
	for name, q := range map[string]string{
		"no range":   "",
		"backwards":  "?from=2030-05-10&to=2030-05-01",
		"too long":   "?from=2030-01-01&to=2030-12-31",
		"not a date": "?from=soon&to=later",
	} {
		if got := e.status(alice, "GET", "/api/v1/calendar"+q, ""); got != 422 {
			t.Errorf("calendar %s = %d, want 422", name, got)
		}
	}
}

func TestTheCalendarShowsDatedTasksFromMyProjects(t *testing.T) {
	e := newEnv(t)
	alice, carol := e.newUser("alice"), e.newUser("carol")
	pid := e.createProject(alice, "Launch")
	e.createTask(alice, pid, `{"title":"Ends in May","dueDate":"2030-05-15"}`)
	e.createTask(alice, pid, `{"title":"Spans May","startDate":"2030-04-20","dueDate":"2030-06-10"}`)
	e.createTask(alice, pid, `{"title":"Starts in May","startDate":"2030-05-03"}`)
	e.createTask(alice, pid, `{"title":"In June","dueDate":"2030-06-15"}`)
	e.createTask(alice, pid, `{"title":"No date"}`)
	gone := e.createTask(alice, pid, `{"title":"Deleted","dueDate":"2030-05-15"}`)
	if got := e.status(alice, "DELETE", "/api/v1/tasks/"+gone, ""); got != 204 {
		t.Fatalf("delete task = %d", got)
	}

	_, tasks := e.calendar(alice, "2030-05-01", "2030-05-31")
	if !eq(tasks, []string{"Spans May", "Starts in May", "Ends in May"}) {
		t.Errorf("alice's tasks in May = %v", tasks)
	}
	if _, tasks := e.calendar(carol, "2030-05-01", "2030-05-31"); len(tasks) != 0 {
		t.Errorf("carol sees other people's tasks: %v", tasks)
	}
	// A project in the trash leaves the calendar, with its days.
	e.createEvent(alice, `{"title":"Launch day","day":"2030-05-20","projectId":"`+pid+`"}`)
	if got := e.status(alice, "DELETE", "/api/v1/projects/"+pid, ""); got != 204 {
		t.Fatalf("delete project = %d", got)
	}
	if ev, tasks := e.calendar(alice, "2030-05-01", "2030-05-31"); len(ev)+len(tasks) != 0 {
		t.Errorf("a trashed project still shows: %v %v", ev, tasks)
	}
}

func TestRemindersGoOutOnTimeOnceEach(t *testing.T) {
	e := newEnv(t)
	alice, bob, carol := e.newUser("alice"), e.newUser("bob"), e.newUser("carol")
	pid := e.createProject(alice, "Launch")
	e.addMember(alice, pid, bob)
	e.createEvent(alice, `{"title":"Demo","day":"2030-05-10","projectId":"`+pid+`","remindDays":[0,1]}`)
	e.createEvent(alice, `{"title":"Dentist","day":"2030-05-10","remindDays":[1]}`)
	e.createEvent(alice, `{"title":"No reminder","day":"2030-05-10"}`)

	if made := e.remindAt("2030-05-09 07:59"); made != 0 {
		t.Errorf("before 08:00 the day before: made %d, want 0", made)
	}
	// 08:00 the day before: "1 day before" for Demo (alice, bob) and Dentist (alice only).
	if made := e.remindAt("2030-05-09 08:00"); made != 3 {
		t.Errorf("08:00 the day before: made %d, want 3", made)
	}
	if made := e.remindAt("2030-05-09 12:00"); made != 0 {
		t.Errorf("running again made %d more, want 0", made)
	}
	// On the day: "on the day" for Demo.
	if made := e.remindAt("2030-05-10 08:00"); made != 2 {
		t.Errorf("08:00 on the day: made %d, want 2", made)
	}
	// After the day nothing is late-delivered.
	if made := e.remindAt("2030-05-11 09:00"); made != 0 {
		t.Errorf("after the day: made %d, want 0", made)
	}

	got, unread := e.inbox(bob)
	if len(got) != 2 || unread != 2 {
		t.Errorf("bob's inbox = %v (unread %v), want 2 Demo reminders", got, unread)
	}
	if got, _ := e.inbox(carol); len(got) != 0 {
		t.Errorf("carol was reminded about other people's days: %v", got)
	}
	if got, unread := e.inbox(alice); len(got) != 3 || unread != 3 {
		t.Errorf("alice's inbox = %v (unread %v), want 3", got, unread)
	}

	// Reading: one, then all.
	first := do(t, e.h, "GET", "/api/v1/notifications", bob.token, "").body["items"].([]any)[0].(map[string]any)["id"].(string)
	if got := e.status(bob, "POST", "/api/v1/notifications/read", `{"ids":["`+first+`"]}`); got != 204 {
		t.Fatalf("read one = %d", got)
	}
	if _, unread := e.inbox(bob); unread != 1 {
		t.Errorf("after reading one, unread = %v, want 1", unread)
	}
	// Bob cannot mark Alice's reminders: hers stay unread.
	if got := e.status(bob, "POST", "/api/v1/notifications/read", `{}`); got != 204 {
		t.Fatalf("read all = %d", got)
	}
	if _, unread := e.inbox(bob); unread != 0 {
		t.Errorf("after reading all, unread = %v, want 0", unread)
	}
	if _, unread := e.inbox(alice); unread != 3 {
		t.Errorf("bob's 'read all' touched alice's reminders: unread %v", unread)
	}
	if got := e.status(bob, "POST", "/api/v1/notifications/read", `{"ids":["nope"]}`); got != 422 {
		t.Errorf("bad id = %d, want 422", got)
	}
}

func TestRemindersFollowTheDayAndTheMembers(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Launch")
	e.addMember(alice, pid, bob)
	id := e.createEvent(alice, `{"title":"Demo","day":"2030-05-10","projectId":"`+pid+`","remindDays":[1]}`)
	e.remindAt("2030-05-09 08:00")

	// The day moves: the old reminder goes, and the new day reminds again.
	if got := e.status(alice, "PATCH", "/api/v1/events/"+id, `{"day":"2030-05-20"}`); got != 200 {
		t.Fatalf("move = %d", got)
	}
	if got, _ := e.inbox(bob); len(got) != 0 {
		t.Errorf("a reminder for the old day is still there: %v", got)
	}
	if made := e.remindAt("2030-05-19 08:00"); made != 2 {
		t.Errorf("new day reminders = %d, want 2", made)
	}

	// Bob leaves the project: its days and their reminders are no longer his to see.
	if got := e.status(alice, "DELETE", "/api/v1/projects/"+pid+"/members/"+bob.id, ""); got != 204 {
		t.Fatalf("remove bob = %d", got)
	}
	if got, unread := e.inbox(bob); len(got) != 0 || unread != 0 {
		t.Errorf("a removed member still sees %v (unread %v)", got, unread)
	}
}
