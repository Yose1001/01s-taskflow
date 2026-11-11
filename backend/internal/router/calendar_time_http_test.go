package router

import (
	"fmt"
	"testing"
)

func TestAnImportantDayCanHaveATimeAndRemindBeforeIt(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")

	r := do(t, e.h, "POST", "/api/v1/events", alice.token,
		`{"title":"Demo","day":"2030-05-10","atTime":"14:00","remindMinutes":[60,15,60],"remindDays":[0]}`)
	if r.code != 201 || r.body["atTime"] != "14:00" || !eq(numbers(r.body["remindMinutes"]), []string{"15", "60"}) {
		t.Fatalf("create = %d %s", r.code, r.raw)
	}
	id := r.body["id"].(string)

	// Without a time, a day says so, and has no reminders before it.
	plain := do(t, e.h, "POST", "/api/v1/events", alice.token, `{"title":"Plain","day":"2030-05-10"}`)
	if plain.body["atTime"] != nil || len(plain.body["remindMinutes"].([]any)) != 0 {
		t.Errorf("plain day = %s", plain.raw)
	}

	for body, want := range map[string][2]string{
		`{"title":"x","day":"2030-05-10","atTime":"25:00"}`:                      {"atTime", "invalid_time"},
		`{"title":"x","day":"2030-05-10","atTime":"9:00"}`:                       {"atTime", "invalid_time"},
		`{"title":"x","day":"2030-05-10","atTime":"09:00","remindMinutes":[10]}`: {"remindMinutes", "invalid_remind_minutes"},
		`{"title":"x","day":"2030-05-10","remindMinutes":[15]}`:                  {"remindMinutes", "needs_time"},
	} {
		got := do(t, e.h, "POST", "/api/v1/events", alice.token, body)
		if got.code != 422 || got.body["fields"].(map[string]any)[want[0]] != want[1] {
			t.Errorf("%s = %d %s", body, got.code, got.raw)
		}
	}

	// Reminders before a time asked for without one are refused; taking the time away takes them too.
	bad := do(t, e.h, "PATCH", "/api/v1/events/"+id, alice.token, `{"atTime":"","remindMinutes":[15]}`)
	if bad.code != 422 {
		t.Errorf("no time but minutes = %d %s", bad.code, bad.raw)
	}
	cleared := do(t, e.h, "PATCH", "/api/v1/events/"+id, alice.token, `{"atTime":""}`)
	if cleared.code != 200 || cleared.body["atTime"] != nil || len(cleared.body["remindMinutes"].([]any)) != 0 {
		t.Errorf("take the time away = %d %s", cleared.code, cleared.raw)
	}
}

func TestRemindersBeforeADaysTime(t *testing.T) {
	e := newEnv(t)
	alice := e.newUser("alice")
	id := e.createEvent(alice, `{"title":"Demo","day":"2030-05-10","atTime":"14:00","remindMinutes":[15,60],"remindDays":[0]}`)
	// An early meeting: by 08:00 it is over, so "on the day" has nothing left to remind of.
	e.createEvent(alice, `{"title":"Breakfast","day":"2030-05-10","atTime":"07:00","remindDays":[0]}`)

	steps := []struct {
		at   string
		want int64
		why  string
	}{
		{"2030-05-10 08:00", 1, "on the day, for Demo only"},
		{"2030-05-10 12:59", 0, "nothing yet"},
		{"2030-05-10 13:00", 1, "an hour before"},
		{"2030-05-10 13:45", 1, "15 minutes before"},
		{"2030-05-10 13:50", 0, "made once"},
		{"2030-05-10 14:01", 0, "the time has passed"},
	}
	for _, s := range steps {
		if made := e.remindAt(s.at); made != s.want {
			t.Errorf("%s (%s): made %d, want %d", s.at, s.why, made, s.want)
		}
	}
	n := do(t, e.h, "GET", "/api/v1/notifications", alice.token, "").body["items"].([]any)
	if len(n) != 3 {
		t.Fatalf("reminders = %v", n)
	}
	newest := n[0].(map[string]any)
	if newest["minutesBefore"] != float64(15) || newest["atTime"] != "14:00" || newest["daysBefore"] != float64(0) {
		t.Errorf("newest reminder = %v", newest)
	}

	// The time moves: the reminders before the old time go, so the new time reminds again; "on the day" stays.
	e.status(alice, "PATCH", "/api/v1/events/"+id, `{"atTime":"16:00"}`)
	if got := len(do(t, e.h, "GET", "/api/v1/notifications", alice.token, "").body["items"].([]any)); got != 1 {
		t.Errorf("after moving the time: %d reminders, want 1", got)
	}
	if made := e.remindAt("2030-05-10 15:00"); made != 1 {
		t.Errorf("an hour before the new time: made %d, want 1", made)
	}
}

// numbers returns a JSON list of numbers as text, for comparing.
func numbers(v any) []string {
	out := []string{}
	for _, n := range v.([]any) {
		out = append(out, fmt.Sprint(n))
	}
	return out
}
