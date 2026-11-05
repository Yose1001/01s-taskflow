package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

const (
	maxTaskTitleLen = 200
	maxTaskDescLen  = 5000
	maxSearchLen    = 100
	dateLayout      = "2006-01-02"

	// A move needs room between two neighbours; below this gap the column is renumbered.
	minPositionGap = 1e-6
	positionStep   = 1024.0
)

// TaskStore is the persistence the task service needs (implemented by repository.TaskRepo).
type TaskStore interface {
	CreateTask(ctx context.Context, projectID, createdBy string, in model.TaskInput) (model.Task, error)
	GetTask(ctx context.Context, taskID, userID string) (model.Task, error)
	ListTasks(ctx context.Context, projectID string, f model.TaskFilter, limit, offset int) ([]model.Task, int, error)
	UpdateTask(ctx context.Context, taskID string, u model.TaskUpdate, at time.Time) error
	SoftDeleteTask(ctx context.Context, taskID, deletedBy string, at time.Time) error
	RestoreTask(ctx context.Context, taskID string, at, cutoff time.Time) error
	BeforePosition(ctx context.Context, projectID, status, beforeTaskID string) (float64, error)
	MaxPositionBelow(ctx context.Context, projectID, status, excludeTaskID string, below *float64) (*float64, error)
	RebalanceColumn(ctx context.Context, projectID, status string) error
	MoveTask(ctx context.Context, taskID, status string, position float64, at time.Time) error
}

// ProjectAccess is the part of the project store used to check membership.
type ProjectAccess interface {
	GetProject(ctx context.Context, projectID, userID string) (model.Project, error)
	GetMemberRole(ctx context.Context, projectID, userID string) (string, error)
}

// TaskOption customises Tasks (used by tests).
type TaskOption func(*Tasks)

// WithTasksClock overrides the clock (used to test trash expiry).
func WithTasksClock(now func() time.Time) TaskOption { return func(t *Tasks) { t.now = now } }

// Tasks implements task rules. Any member of a project may do anything with its tasks;
// everyone else gets model.ErrNotFound (404), so other people's tasks are invisible.
type Tasks struct {
	store     TaskStore
	projects  ProjectAccess
	retention time.Duration
	now       func() time.Time
}

// NewTasks builds the service. retentionDays is how long deleted tasks stay restorable.
func NewTasks(store TaskStore, projects ProjectAccess, retentionDays int, opts ...TaskOption) *Tasks {
	t := &Tasks{store: store, projects: projects, retention: time.Duration(retentionDays) * 24 * time.Hour, now: time.Now}
	for _, o := range opts {
		o(t)
	}
	return t
}

// TaskCreate is the raw request to create a task.
type TaskCreate struct {
	Title       string
	Description string
	Status      string // default "todo"
	Priority    string // default "medium"
	AssigneeID  *string
	DueDate     *string // "YYYY-MM-DD"
}

// TaskPage is a page of tasks with the overall total.
type TaskPage struct {
	Items []model.Task
	Total int
}

// Create adds a task to the end of its column.
func (s *Tasks) Create(ctx context.Context, userID, projectID string, in TaskCreate) (model.Task, error) {
	if _, err := s.project(ctx, userID, projectID); err != nil {
		return model.Task{}, err
	}

	fields := map[string]string{}
	title := strings.TrimSpace(in.Title)
	if code := validateTaskTitle(title); code != "" {
		fields["title"] = code
	}
	if utf8.RuneCountInString(in.Description) > maxTaskDescLen {
		fields["description"] = "description_too_long"
	}
	status, priority := in.Status, in.Priority
	if status == "" {
		status = "todo"
	}
	if priority == "" {
		priority = "medium"
	}
	if !contains(model.Statuses, status) {
		fields["status"] = "invalid_status"
	}
	if !contains(model.Priorities, priority) {
		fields["priority"] = "invalid_priority"
	}
	if in.AssigneeID != nil {
		if code := s.checkAssignee(ctx, projectID, *in.AssigneeID); code != "" {
			fields["assigneeId"] = code
		}
	}
	due, code := parseDate(in.DueDate)
	if code != "" {
		fields["dueDate"] = code
	}
	if len(fields) > 0 {
		return model.Task{}, &ValidationError{Fields: fields}
	}

	return s.store.CreateTask(ctx, projectID, userID, model.TaskInput{
		Title: title, Description: in.Description, Status: status, Priority: priority, AssigneeID: in.AssigneeID, DueDate: due,
	})
}

// List returns a project's tasks (or, with trashed, its restorable deleted tasks).
func (s *Tasks) List(ctx context.Context, userID, projectID string, f model.TaskFilter, page, pageSize int) (TaskPage, error) {
	if _, err := s.project(ctx, userID, projectID); err != nil {
		return TaskPage{}, err
	}

	fields := map[string]string{}
	if f.Status != "" && !contains(model.Statuses, f.Status) {
		fields["status"] = "invalid_status"
	}
	if f.Priority != "" && !contains(model.Priorities, f.Priority) {
		fields["priority"] = "invalid_priority"
	}
	if f.AssigneeID != "" && !uuidRe.MatchString(f.AssigneeID) {
		fields["assigneeId"] = "invalid_assignee"
	}
	if utf8.RuneCountInString(f.Query) > maxSearchLen {
		fields["q"] = "query_too_long"
	}
	if len(fields) > 0 {
		return TaskPage{}, &ValidationError{Fields: fields}
	}

	f.Cutoff = s.cutoff()
	limit, offset := paging(page, pageSize)
	items, total, err := s.store.ListTasks(ctx, projectID, f, limit, offset)
	if err != nil {
		return TaskPage{}, err
	}
	for i := range items {
		items[i] = s.withPurge(items[i])
	}
	return TaskPage{Items: items, Total: total}, nil
}

// Get returns an active task the user can see.
func (s *Tasks) Get(ctx context.Context, userID, taskID string) (model.Task, error) {
	return s.active(ctx, userID, taskID)
}

// Update changes a task's fields (status and position change only through Move).
func (s *Tasks) Update(ctx context.Context, userID, taskID string, p model.TaskPatch) (model.Task, error) {
	t, err := s.active(ctx, userID, taskID)
	if err != nil {
		return model.Task{}, err
	}

	fields := map[string]string{}
	u := model.TaskUpdate{}

	if p.Title == nil && p.Description == nil && p.Priority == nil && !p.AssigneeID.Set && !p.DueDate.Set {
		fields["body"] = "nothing_to_update"
	}
	if p.Title != nil {
		title := strings.TrimSpace(*p.Title)
		if code := validateTaskTitle(title); code != "" {
			fields["title"] = code
		}
		u.Title = &title
	}
	if p.Description != nil {
		if utf8.RuneCountInString(*p.Description) > maxTaskDescLen {
			fields["description"] = "description_too_long"
		}
		u.Description = p.Description
	}
	if p.Priority != nil {
		if !contains(model.Priorities, *p.Priority) {
			fields["priority"] = "invalid_priority"
		}
		u.Priority = p.Priority
	}
	if p.AssigneeID.Set {
		u.SetAssignee, u.AssigneeID = true, p.AssigneeID.Value // null clears the assignee
		if u.AssigneeID != nil {
			if code := s.checkAssignee(ctx, t.ProjectID, *u.AssigneeID); code != "" {
				fields["assigneeId"] = code
			}
		}
	}
	if p.DueDate.Set {
		due, code := parseDate(p.DueDate.Value)
		if code != "" {
			fields["dueDate"] = code
		}
		u.SetDueDate, u.DueDate = true, due // null clears the date
	}
	if len(fields) > 0 {
		return model.Task{}, &ValidationError{Fields: fields}
	}

	if err := s.store.UpdateTask(ctx, taskID, u, s.now()); err != nil {
		return model.Task{}, err
	}
	return s.active(ctx, userID, taskID)
}

// Delete moves a task to the trash.
func (s *Tasks) Delete(ctx context.Context, userID, taskID string) error {
	if _, err := s.active(ctx, userID, taskID); err != nil {
		return err
	}
	return s.store.SoftDeleteTask(ctx, taskID, userID, s.now())
}

// Restore takes a task out of the trash (within the retention period). Any project member may do it.
func (s *Tasks) Restore(ctx context.Context, userID, taskID string) (model.Task, error) {
	if !uuidRe.MatchString(taskID) {
		return model.Task{}, model.ErrNotFound
	}
	t, err := s.store.GetTask(ctx, taskID, userID)
	if err != nil {
		return model.Task{}, err
	}
	if t.DeletedAt == nil || !t.DeletedAt.After(s.cutoff()) {
		return model.Task{}, model.ErrNotFound // not in the trash, or retention is over
	}
	if err := s.store.RestoreTask(ctx, taskID, s.now(), s.cutoff()); err != nil {
		return model.Task{}, err
	}
	return s.active(ctx, userID, taskID)
}

// Move puts a task into a column, before another task (or at the end when beforeTaskID is nil).
func (s *Tasks) Move(ctx context.Context, userID, taskID, status string, beforeTaskID *string) (model.Task, error) {
	t, err := s.active(ctx, userID, taskID)
	if err != nil {
		return model.Task{}, err
	}

	fields := map[string]string{}
	if !contains(model.Statuses, status) {
		fields["status"] = "invalid_status"
	}
	if beforeTaskID != nil && (!uuidRe.MatchString(*beforeTaskID) || *beforeTaskID == taskID) {
		fields["beforeTaskId"] = "invalid_before_task"
	}
	if len(fields) > 0 {
		return model.Task{}, &ValidationError{Fields: fields}
	}

	pos, err := s.newPosition(ctx, t, status, beforeTaskID)
	if err != nil {
		return model.Task{}, err
	}
	if err := s.store.MoveTask(ctx, taskID, status, pos, s.now()); err != nil {
		return model.Task{}, err
	}
	return s.active(ctx, userID, taskID)
}

// newPosition computes where the task goes. Positions are fractions, so a task can be inserted
// between two others without rewriting the column; when the gap gets too small it is renumbered.
func (s *Tasks) newPosition(ctx context.Context, t model.Task, status string, beforeID *string) (float64, error) {
	for attempt := 0; attempt < 2; attempt++ {
		if beforeID == nil { // end of the column
			max, err := s.store.MaxPositionBelow(ctx, t.ProjectID, status, t.ID, nil)
			if err != nil {
				return 0, err
			}
			if max == nil {
				return positionStep, nil
			}
			return *max + positionStep, nil
		}

		beforePos, err := s.store.BeforePosition(ctx, t.ProjectID, status, *beforeID)
		if errors.Is(err, model.ErrNotFound) {
			// Not an active task of that column in this project.
			return 0, &ValidationError{Fields: map[string]string{"beforeTaskId": "invalid_before_task"}}
		}
		if err != nil {
			return 0, err
		}
		prev, err := s.store.MaxPositionBelow(ctx, t.ProjectID, status, t.ID, &beforePos)
		if err != nil {
			return 0, err
		}

		lower := 0.0
		if prev != nil {
			lower = *prev
		}
		if beforePos-lower >= minPositionGap*2 {
			return (lower + beforePos) / 2, nil
		}
		// Too little room: renumber the column once, then try again.
		if err := s.store.RebalanceColumn(ctx, t.ProjectID, status); err != nil {
			return 0, err
		}
	}
	return 0, &ValidationError{Fields: map[string]string{"beforeTaskId": "no_room"}}
}

// project loads a project the user belongs to and that is not in the trash.
func (s *Tasks) project(ctx context.Context, userID, projectID string) (model.Project, error) {
	if !uuidRe.MatchString(projectID) {
		return model.Project{}, model.ErrNotFound
	}
	p, err := s.projects.GetProject(ctx, projectID, userID)
	if err != nil {
		return model.Project{}, err
	}
	if p.DeletedAt != nil {
		return model.Project{}, model.ErrNotFound
	}
	return p, nil
}

// active loads a task the user can see that is not in the trash.
func (s *Tasks) active(ctx context.Context, userID, taskID string) (model.Task, error) {
	if !uuidRe.MatchString(taskID) {
		return model.Task{}, model.ErrNotFound
	}
	t, err := s.store.GetTask(ctx, taskID, userID)
	if err != nil {
		return model.Task{}, err
	}
	if t.DeletedAt != nil {
		return model.Task{}, model.ErrNotFound
	}
	return t, nil
}

// checkAssignee returns an error code when the user is not a valid assignee for the project.
func (s *Tasks) checkAssignee(ctx context.Context, projectID, assigneeID string) string {
	if !uuidRe.MatchString(assigneeID) {
		return "invalid_assignee"
	}
	if _, err := s.projects.GetMemberRole(ctx, projectID, assigneeID); err != nil {
		return "not_a_member"
	}
	return ""
}

func (s *Tasks) cutoff() time.Time { return s.now().Add(-s.retention) }

func (s *Tasks) withPurge(t model.Task) model.Task {
	if t.DeletedAt != nil {
		purge := t.DeletedAt.Add(s.retention)
		t.PurgeAt = &purge
	}
	return t
}

func validateTaskTitle(title string) string {
	n := utf8.RuneCountInString(title)
	if n < 1 || n > maxTaskTitleLen {
		return "invalid_title"
	}
	for _, r := range title {
		if unicode.IsControl(r) {
			return "invalid_title"
		}
	}
	return ""
}

// parseDate reads an optional "YYYY-MM-DD" date. nil in -> nil out with no error.
func parseDate(s *string) (*time.Time, string) {
	if s == nil {
		return nil, ""
	}
	d, err := time.Parse(dateLayout, *s)
	if err != nil {
		return nil, "invalid_date"
	}
	return &d, ""
}
