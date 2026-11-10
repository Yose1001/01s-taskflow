package model

import "time"

// RemindDays are the only reminder choices: on the day, and 1, 3 or 7 days before.
var RemindDays = []int{0, 1, 3, 7}

// Event is an important day on the calendar, as one person sees it. It belongs either to that
// person (ProjectID nil) or to a project they are a member of.
type Event struct {
	ID          string
	Title       string
	Note        string
	Day         time.Time
	ProjectID   *string
	ProjectName *string
	OwnerID     *string
	CreatedBy   string
	RemindDays  []int
	// CanEdit: the person may change or remove it (theirs, they created it, or they own its project).
	CanEdit   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// EventInput is a checked important day to store.
type EventInput struct {
	Title      string
	Note       string
	Day        time.Time
	ProjectID  *string // nil = a personal day of the creator
	RemindDays []int
}

// EventPatch is a checked change. Nil fields stay as they are; where it belongs never changes.
type EventPatch struct {
	Title      *string
	Note       *string
	Day        *time.Time
	RemindDays *[]int
}

// CalendarTask is a task with a date, as the calendar shows it.
type CalendarTask struct {
	ID          string
	ProjectID   string
	ProjectName string
	Title       string
	Status      string
	StartDate   *time.Time
	DueDate     *time.Time
}

// Notification is one reminder about an important day.
type Notification struct {
	ID          string
	EventID     string
	Title       string
	Day         time.Time
	ProjectID   *string
	ProjectName *string
	DaysBefore  int
	CreatedAt   time.Time
	ReadAt      *time.Time
}
