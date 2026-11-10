package router

import (
	"testing"
)

// names returns the display names in a list of people from the API.
func names(list any) []string {
	out := []string{}
	for _, p := range list.([]any) {
		out = append(out, p.(map[string]any)["displayName"].(string))
	}
	return out
}

func TestWhoAnImportantDayCanBeSharedWith(t *testing.T) {
	e := newEnv(t)
	alice, bob, carol, dave := e.newUser("alice"), e.newUser("bob"), e.newUser("carol"), e.newUser("dave")
	launch := e.createProject(alice, "Launch")
	e.addMember(alice, launch, bob)
	shop := e.createProject(carol, "Shop")
	e.addMember(carol, shop, alice)
	e.createProject(dave, "Alone")

	r := do(t, e.h, "GET", "/api/v1/people", alice.token, "")
	if r.code != 200 || !eq(names(r.body["items"]), []string{"bob", "carol"}) {
		t.Errorf("alice may share with %d %s, want bob and carol (not herself, not dave)", r.code, r.raw)
	}
	if r := do(t, e.h, "GET", "/api/v1/people", dave.token, ""); len(r.body["items"].([]any)) != 0 {
		t.Errorf("dave, alone in his project, sees %s", r.raw)
	}

	for name, body := range map[string]string{
		"a stranger":      `{"title":"x","day":"2030-05-10","sharedWith":["` + dave.id + `"]}`,
		"herself":         `{"title":"x","day":"2030-05-10","sharedWith":["` + alice.id + `"]}`,
		"not an id":       `{"title":"x","day":"2030-05-10","sharedWith":["bob"]}`,
		"a project's day": `{"title":"x","day":"2030-05-10","projectId":"` + launch + `","sharedWith":["` + bob.id + `"]}`,
	} {
		if got := e.status(alice, "POST", "/api/v1/events", body); got != 422 {
			t.Errorf("share with %s = %d, want 422", name, got)
		}
	}
	// A project in the trash no longer makes people sharable.
	if got := e.status(carol, "DELETE", "/api/v1/projects/"+shop, ""); got != 204 {
		t.Fatalf("trash shop = %d", got)
	}
	if r := do(t, e.h, "GET", "/api/v1/people", alice.token, ""); !eq(names(r.body["items"]), []string{"bob"}) {
		t.Errorf("after the shared project went to the trash, alice may share with %s", r.raw)
	}
}

func TestASharedDayIsSeenAndRemindedButNotChanged(t *testing.T) {
	e := newEnv(t)
	alice, bob, carol := e.newUser("alice"), e.newUser("bob"), e.newUser("carol")
	pid := e.createProject(alice, "Launch")
	e.addMember(alice, pid, bob)
	e.addMember(alice, pid, carol)

	r := do(t, e.h, "POST", "/api/v1/events", alice.token,
		`{"title":"Team lunch","day":"2030-05-10","remindDays":[1],"sharedWith":["`+carol.id+`","`+bob.id+`","`+bob.id+`"]}`)
	if r.code != 201 || r.body["projectId"] != nil || r.body["sharedBy"] != nil ||
		!eq(names(r.body["sharedWith"]), []string{"bob", "carol"}) {
		t.Fatalf("create shared day = %d %s", r.code, r.raw)
	}
	id := r.body["id"].(string)

	// Bob sees it as shared by Alice, without the list of who else, and may not change it.
	b := do(t, e.h, "GET", "/api/v1/calendar?from=2030-05-01&to=2030-05-31", bob.token, "")
	ev := b.body["events"].([]any)[0].(map[string]any)
	if ev["title"] != "Team lunch" || ev["sharedBy"] != "alice" || ev["canEdit"] != false || len(ev["sharedWith"].([]any)) != 0 {
		t.Errorf("bob's view = %v", ev)
	}
	if got := e.status(bob, "PATCH", "/api/v1/events/"+id, `{"title":"mine now"}`); got != 403 {
		t.Errorf("bob changes a day shared with him = %d, want 403", got)
	}
	if got := e.status(bob, "DELETE", "/api/v1/events/"+id, ""); got != 403 {
		t.Errorf("bob removes a day shared with him = %d, want 403", got)
	}

	// Everyone it is shared with is reminded, and the owner too.
	if made := e.remindAt("2030-05-09 08:00"); made != 3 {
		t.Errorf("reminders = %d, want 3 (alice, bob, carol)", made)
	}
	n := do(t, e.h, "GET", "/api/v1/notifications", carol.token, "").body["items"].([]any)
	if len(n) != 1 || n[0].(map[string]any)["sharedBy"] != "alice" {
		t.Errorf("carol's reminder = %v", n)
	}

	// Alice takes Bob off: the day and its reminder leave his calendar and his bell.
	r = do(t, e.h, "PATCH", "/api/v1/events/"+id, alice.token, `{"sharedWith":["`+carol.id+`"]}`)
	if r.code != 200 || !eq(names(r.body["sharedWith"]), []string{"carol"}) {
		t.Fatalf("unshare bob = %d %s", r.code, r.raw)
	}
	if ev, _ := e.calendar(bob, "2030-05-01", "2030-05-31"); len(ev) != 0 {
		t.Errorf("bob still sees %v", ev)
	}
	if got, unread := e.inbox(bob); len(got) != 0 || unread != 0 {
		t.Errorf("bob still has %v (unread %v)", got, unread)
	}
	if ev, _ := e.calendar(carol, "2030-05-01", "2030-05-31"); !eq(ev, []string{"Team lunch"}) {
		t.Errorf("carol sees %v", ev)
	}
	// Sharing an empty list makes it personal again.
	if r := do(t, e.h, "PATCH", "/api/v1/events/"+id, alice.token, `{"sharedWith":[]}`); r.code != 200 || len(r.body["sharedWith"].([]any)) != 0 {
		t.Errorf("unshare all = %d %s", r.code, r.raw)
	}
	if ev, _ := e.calendar(carol, "2030-05-01", "2030-05-31"); len(ev) != 0 {
		t.Errorf("carol still sees %v", ev)
	}
}

func TestOnlyPersonalDaysAreShared(t *testing.T) {
	e := newEnv(t)
	alice, bob := e.newUser("alice"), e.newUser("bob")
	pid := e.createProject(alice, "Launch")
	e.addMember(alice, pid, bob)
	id := e.createEvent(alice, `{"title":"Demo","day":"2030-05-10","projectId":"`+pid+`"}`)
	if got := e.status(alice, "PATCH", "/api/v1/events/"+id, `{"sharedWith":["`+bob.id+`"]}`); got != 422 {
		t.Errorf("share a project's day = %d, want 422", got)
	}
}
