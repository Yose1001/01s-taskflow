package service

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

const (
	maxEventTitleLen = 120
	maxEventNoteLen  = 1000
	// A calendar page shows at most this many days: six weeks of a month view, with room to spare.
	maxCalendarSpanDays = 100
	maxNotifications    = 50
)

// EventStore is the persistence the calendar needs (implemented by repository.EventRepo).
type EventStore interface {
	ListEvents(ctx context.Context, userID, from, to string) ([]model.Event, error)
	GetEvent(ctx context.Context, userID, eventID string) (model.Event, error)
	CreateEvent(ctx context.Context, userID string, in model.EventInput, at time.Time) (model.Event, error)
	UpdateEvent(ctx context.Context, eventID string, p model.EventPatch, at time.Time) error
	DeleteEvent(ctx context.Context, eventID string) error
	ListCalendarTasks(ctx context.Context, userID, from, to string) ([]model.CalendarTask, error)
	ListNotifications(ctx context.Context, userID string, limit int) ([]model.Notification, int, error)
	MarkRead(ctx context.Context, userID string, ids []string, at time.Time) error
}

// CalendarOption customises Calendar (used by tests).
type CalendarOption func(*Calendar)

// WithCalendarClock overrides the clock.
func WithCalendarClock(now func() time.Time) CalendarOption { return func(c *Calendar) { c.now = now } }

// Calendar implements the rules for important days and their reminders.
//   - A personal day is seen and changed only by its owner.
//   - A project's day is seen by every member and added by any member; it is changed or removed by
//     the person who added it or by the project's owner.
//   - Days someone cannot see are model.ErrNotFound (404), so they cannot tell they exist.
type Calendar struct {
	store    EventStore
	projects ProjectAccess
	now      func() time.Time
}

// NewCalendar builds the service.
func NewCalendar(store EventStore, projects ProjectAccess, opts ...CalendarOption) *Calendar {
	c := &Calendar{store: store, projects: projects, now: time.Now}
	for _, o := range opts {
		o(c)
	}
	return c
}

// EventCreate is the raw request to add an important day.
type EventCreate struct {
	Title      string
	Note       string
	Day        string  // "YYYY-MM-DD"
	ProjectID  *string // nil = personal
	RemindDays []int
}

// EventUpdate is the raw request to change one. Nil fields stay as they are.
type EventUpdate struct {
	Title      *string
	Note       *string
	Day        *string
	RemindDays *[]int
}

// CalendarPage is what one calendar view shows.
type CalendarPage struct {
	Events []model.Event
	Tasks  []model.CalendarTask
}

// Range returns the important days and dated tasks userID can see from one day to another, both included.
func (c *Calendar) Range(ctx context.Context, userID, from, to string) (CalendarPage, error) {
	fields := map[string]string{}
	start, err := time.Parse(dateLayout, from)
	if err != nil {
		fields["from"] = "invalid_date"
	}
	end, err := time.Parse(dateLayout, to)
	if err != nil {
		fields["to"] = "invalid_date"
	}
	if len(fields) == 0 {
		switch {
		case end.Before(start):
			fields["to"] = "before_from"
		case end.Sub(start) > maxCalendarSpanDays*24*time.Hour:
			fields["to"] = "range_too_long"
		}
	}
	if len(fields) > 0 {
		return CalendarPage{}, &ValidationError{Fields: fields}
	}
	events, err := c.store.ListEvents(ctx, userID, from, to)
	if err != nil {
		return CalendarPage{}, err
	}
	tasks, err := c.store.ListCalendarTasks(ctx, userID, from, to)
	if err != nil {
		return CalendarPage{}, err
	}
	return CalendarPage{Events: events, Tasks: tasks}, nil
}

// Create adds an important day: userID's own, or for a project they are a member of.
func (c *Calendar) Create(ctx context.Context, userID string, in EventCreate) (model.Event, error) {
	fields := map[string]string{}
	title := strings.TrimSpace(in.Title)
	if code := checkEventTitle(title); code != "" {
		fields["title"] = code
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > maxEventNoteLen {
		fields["note"] = "too_long"
	}
	day, err := time.Parse(dateLayout, in.Day)
	if err != nil {
		fields["day"] = "invalid_date"
	}
	days, code := checkRemindDays(in.RemindDays)
	if code != "" {
		fields["remindDays"] = code
	}
	if in.ProjectID != nil {
		if _, err := c.activeProject(ctx, userID, *in.ProjectID); err != nil {
			// Someone else's project, or one in the trash, is simply not a place to put a day.
			fields["projectId"] = "not_a_member"
		}
	}
	if len(fields) > 0 {
		return model.Event{}, &ValidationError{Fields: fields}
	}
	var project *string
	if in.ProjectID != nil {
		id := strings.ToLower(*in.ProjectID)
		project = &id
	}
	return c.store.CreateEvent(ctx, userID, model.EventInput{
		Title: title, Note: note, Day: day, ProjectID: project, RemindDays: days,
	}, c.now())
}

// Update changes an important day userID may change. Where it belongs never changes.
func (c *Calendar) Update(ctx context.Context, userID, eventID string, in EventUpdate) (model.Event, error) {
	ev, err := c.editable(ctx, userID, eventID)
	if err != nil {
		return model.Event{}, err
	}
	fields := map[string]string{}
	var patch model.EventPatch
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if code := checkEventTitle(title); code != "" {
			fields["title"] = code
		}
		patch.Title = &title
	}
	if in.Note != nil {
		note := strings.TrimSpace(*in.Note)
		if utf8.RuneCountInString(note) > maxEventNoteLen {
			fields["note"] = "too_long"
		}
		patch.Note = &note
	}
	if in.Day != nil {
		day, err := time.Parse(dateLayout, *in.Day)
		if err != nil {
			fields["day"] = "invalid_date"
		}
		patch.Day = &day
	}
	if in.RemindDays != nil {
		days, code := checkRemindDays(*in.RemindDays)
		if code != "" {
			fields["remindDays"] = code
		}
		patch.RemindDays = &days
	}
	if len(fields) > 0 {
		return model.Event{}, &ValidationError{Fields: fields}
	}
	if err := c.store.UpdateEvent(ctx, ev.ID, patch, c.now()); err != nil {
		return model.Event{}, err
	}
	return c.store.GetEvent(ctx, userID, ev.ID)
}

// Delete removes an important day userID may change, for good.
func (c *Calendar) Delete(ctx context.Context, userID, eventID string) error {
	ev, err := c.editable(ctx, userID, eventID)
	if err != nil {
		return err
	}
	return c.store.DeleteEvent(ctx, ev.ID)
}

// Notifications returns userID's newest reminders and how many of them are unread.
func (c *Calendar) Notifications(ctx context.Context, userID string) ([]model.Notification, int, error) {
	return c.store.ListNotifications(ctx, userID, maxNotifications)
}

// MarkRead marks userID's reminders as read: the ones listed, or all of them when none are listed.
func (c *Calendar) MarkRead(ctx context.Context, userID string, ids []string) error {
	for _, id := range ids {
		if !uuidRe.MatchString(id) {
			return &ValidationError{Fields: map[string]string{"ids": "invalid_id"}}
		}
	}
	return c.store.MarkRead(ctx, userID, ids, c.now())
}

// editable loads an important day userID can see, and refuses when they may not change it.
func (c *Calendar) editable(ctx context.Context, userID, eventID string) (model.Event, error) {
	if !uuidRe.MatchString(eventID) {
		return model.Event{}, model.ErrNotFound
	}
	ev, err := c.store.GetEvent(ctx, userID, eventID)
	if err != nil {
		return model.Event{}, err
	}
	if !ev.CanEdit {
		return model.Event{}, ErrForbidden
	}
	return ev, nil
}

func (c *Calendar) activeProject(ctx context.Context, userID, projectID string) (model.Project, error) {
	if !uuidRe.MatchString(projectID) {
		return model.Project{}, model.ErrNotFound
	}
	p, err := c.projects.GetProject(ctx, projectID, userID)
	if err != nil {
		return model.Project{}, err
	}
	if p.DeletedAt != nil {
		return model.Project{}, model.ErrNotFound
	}
	return p, nil
}

func checkEventTitle(title string) string {
	switch n := utf8.RuneCountInString(title); {
	case n == 0:
		return "required"
	case n > maxEventTitleLen:
		return "too_long"
	}
	return ""
}

// checkRemindDays returns the choices sorted and without repeats, or an error code. Never nil.
func checkRemindDays(days []int) ([]int, string) {
	out := make([]int, 0, len(days))
	for _, d := range days {
		if !slices.Contains(model.RemindDays, d) {
			return nil, "invalid_remind_day"
		}
		out = append(out, d)
	}
	slices.Sort(out)
	return slices.Compact(out), ""
}
