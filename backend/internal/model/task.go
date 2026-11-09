package model

import (
	"encoding/json"
	"time"
)

// StatusOnHold is the column for paused work. A task in it always has a reason; no other task has one.
const StatusOnHold = "on_hold"

// Task statuses and priorities (must match the CHECK constraints in the schema).
var (
	Statuses   = []string{"todo", "in_progress", "review", StatusOnHold, "done"}
	Priorities = []string{"low", "medium", "high"}
)

// Task is a unit of work on a project board.
type Task struct {
	ID          string
	ProjectID   string
	Title       string
	Description string
	Status      string
	Priority    string
	HoldReason  *string   // why it is on hold; nil in every other column
	AssigneeIDs []string  // everyone working on it, possibly nobody
	Subtasks    []Subtask // the smaller things to do, in order
	CreatedBy   string
	StartDate   *time.Time // a calendar date (UTC midnight)
	DueDate     *time.Time // the end date: a calendar date (UTC midnight)
	Position    float64    // order within its status column (smaller = higher on the board)
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   *time.Time // set while the task is in the trash
	PurgeAt     *time.Time // when it will be deleted for good
}

// Subtask is one line of a task's checklist. The JSON names are how the database returns them.
type Subtask struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Done  bool   `json:"done"`
}

// SubtaskPatch is a request to change a subtask. Absent fields stay unchanged.
type SubtaskPatch struct {
	Title *string
	Done  *bool
}

// Nullable distinguishes "field absent" (leave unchanged) from "field is null" (clear it) in PATCH bodies.
type Nullable[T any] struct {
	Set   bool
	Value *T // nil when the client sent null
}

// UnmarshalJSON marks the field as present and decodes null as a nil Value.
func (n *Nullable[T]) UnmarshalJSON(b []byte) error {
	n.Set = true
	if string(b) == "null" {
		n.Value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	n.Value = &v
	return nil
}

// TaskInput is a validated request to create a task.
type TaskInput struct {
	Title       string
	Description string
	Status      string
	Priority    string
	HoldReason  *string
	AssigneeIDs []string
	Subtasks    []string // titles, in order
	StartDate   *time.Time
	DueDate     *time.Time
}

// TaskPatch is the raw (not yet validated) PATCH request. Absent fields stay unchanged.
type TaskPatch struct {
	Title       *string
	Description *string
	Priority    *string
	HoldReason  *string
	AssigneeIDs *[]string        // the whole new list; an empty list clears it
	StartDate   Nullable[string] // "YYYY-MM-DD" or null
	DueDate     Nullable[string] // "YYYY-MM-DD" or null
}

// TaskUpdate is a validated change set passed to the store.
type TaskUpdate struct {
	Title        *string
	Description  *string
	Priority     *string
	HoldReason   *string
	SetAssignees bool
	AssigneeIDs  []string
	SetStartDate bool
	StartDate    *time.Time
	SetDueDate   bool
	DueDate      *time.Time
}

// TaskFilter narrows a task listing.
type TaskFilter struct {
	Status     string
	Priority   string
	AssigneeID string
	Query      string // case-insensitive substring of the title
	Trashed    bool
	Cutoff     time.Time // with Trashed: only tasks deleted after this instant
}
