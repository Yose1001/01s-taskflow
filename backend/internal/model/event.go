package model

import "time"

// RemindDays are the only reminder choices: on the day, and 1, 3 or 7 days before.
var RemindDays = []int{0, 1, 3, 7}

// Person is someone the signed-in person can share an important day with.
type Person struct {
	UserID      string
	DisplayName string
	Email       string
}

// Event is an important day on the calendar, as one person sees it. It belongs either to one person
// (ProjectID nil, maybe shared with others) or to a project they are a member of.
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
	// SharedWith lists who a personal day is shared with. Only its owner is told; others get nil.
	SharedWith []Person
	// SharedBy is the owner's name when the day was shared with the person looking; nil otherwise.
	SharedBy *string
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
	ProjectID  *string  // nil = a personal day of the creator
	SharedWith []string // user ids; personal days only
	RemindDays []int
}

// EventPatch is a checked change. Nil fields stay as they are; where it belongs never changes.
type EventPatch struct {
	Title      *string
	Note       *string
	Day        *time.Time
	RemindDays *[]int
	SharedWith *[]string // the whole new list; personal days only
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
	// AssigneeIDs are the people working on it, so the calendar can show one person's tasks.
	AssigneeIDs []string
}

// Notification is one reminder about an important day.
type Notification struct {
	ID          string
	EventID     string
	Title       string
	Day         time.Time
	ProjectID   *string
	ProjectName *string
	SharedBy    *string
	DaysBefore  int
	CreatedAt   time.Time
	ReadAt      *time.Time
}
