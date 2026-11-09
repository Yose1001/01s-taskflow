package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/httpx"
	"github.com/Yose1001/taskflow/backend/internal/model"
	"github.com/Yose1001/taskflow/backend/internal/service"
)

// TaskService is what the task handlers need from the service layer.
type TaskService interface {
	Create(ctx context.Context, userID, projectID string, in service.TaskCreate) (model.Task, error)
	List(ctx context.Context, userID, projectID string, f model.TaskFilter, page, pageSize int) (service.TaskPage, error)
	Get(ctx context.Context, userID, taskID string) (model.Task, error)
	Update(ctx context.Context, userID, taskID string, p model.TaskPatch) (model.Task, error)
	AddSubtask(ctx context.Context, userID, taskID, title string) (model.Subtask, error)
	UpdateSubtask(ctx context.Context, userID, taskID, subtaskID string, p model.SubtaskPatch) (model.Subtask, error)
	DeleteSubtask(ctx context.Context, userID, taskID, subtaskID string) error
	Delete(ctx context.Context, userID, taskID string) error
	Restore(ctx context.Context, userID, taskID string) (model.Task, error)
	Move(ctx context.Context, userID, taskID, status string, beforeTaskID, holdReason *string) (model.Task, error)
}

// Tasks serves the task routes. Every route must be wrapped by middleware.Authenticate.
type Tasks struct{ svc TaskService }

// NewTasks returns the task handlers.
func NewTasks(svc TaskService) *Tasks { return &Tasks{svc: svc} }

type taskResponse struct {
	ID          string            `json:"id"`
	ProjectID   string            `json:"projectId"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Status      string            `json:"status"`
	Priority    string            `json:"priority"`
	HoldReason  *string           `json:"holdReason"`
	AssigneeIDs []string          `json:"assigneeIds"`
	Subtasks    []subtaskResponse `json:"subtasks"`
	CreatedBy   string            `json:"createdBy"`
	StartDate   *string           `json:"startDate"`
	DueDate     *string           `json:"dueDate"`
	Position    float64           `json:"position"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
	DeletedAt   *time.Time        `json:"deletedAt"`
	PurgeAt     *time.Time        `json:"purgeAt"`
}

type subtaskResponse struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Done  bool   `json:"done"`
}

// dateString formats an optional calendar date as "YYYY-MM-DD".
func dateString(d *time.Time) *string {
	if d == nil {
		return nil
	}
	s := d.Format("2006-01-02")
	return &s
}

func toTaskResponse(t model.Task) taskResponse {
	assignees := t.AssigneeIDs
	if assignees == nil {
		assignees = []string{} // always a list in JSON, never null
	}
	subtasks := make([]subtaskResponse, 0, len(t.Subtasks))
	for _, s := range t.Subtasks {
		subtasks = append(subtasks, subtaskResponse(s))
	}
	return taskResponse{ID: t.ID, ProjectID: t.ProjectID, Title: t.Title, Description: t.Description, Status: t.Status,
		Priority: t.Priority, HoldReason: t.HoldReason, AssigneeIDs: assignees, Subtasks: subtasks, CreatedBy: t.CreatedBy, StartDate: dateString(t.StartDate), DueDate: dateString(t.DueDate), Position: t.Position,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt, DeletedAt: t.DeletedAt, PurgeAt: t.PurgeAt}
}

// Create handles POST /projects/{projectId}/tasks.
func (h *Tasks) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Status      string   `json:"status"`
		Priority    string   `json:"priority"`
		HoldReason  *string  `json:"holdReason"`
		AssigneeIDs []string `json:"assigneeIds"`
		Subtasks    []string `json:"subtasks"`
		StartDate   *string  `json:"startDate"`
		DueDate     *string  `json:"dueDate"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := h.svc.Create(r.Context(), uid, r.PathValue("projectId"), service.TaskCreate{
		Title: in.Title, Description: in.Description, Status: in.Status, Priority: in.Priority, HoldReason: in.HoldReason, AssigneeIDs: in.AssigneeIDs, Subtasks: in.Subtasks, StartDate: in.StartDate, DueDate: in.DueDate,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toTaskResponse(t))
}

// List handles GET /projects/{projectId}/tasks?status=&priority=&assigneeId=&q=&trashed=&page=&pageSize=.
func (h *Tasks) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	fields := map[string]string{}

	trashed := false
	if v := q.Get("trashed"); v != "" {
		if v != "true" && v != "false" {
			fields["trashed"] = "invalid_boolean"
		}
		trashed = v == "true"
	}
	page := intParam(q.Get("page"), "page", fields)
	size := intParam(q.Get("pageSize"), "pageSize", fields)
	if len(fields) > 0 {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_failed", "validation failed", fields)
		return
	}

	res, err := h.svc.List(r.Context(), uid, r.PathValue("projectId"), model.TaskFilter{
		Status: q.Get("status"), Priority: q.Get("priority"), AssigneeID: q.Get("assigneeId"), Query: q.Get("q"), Trashed: trashed,
	}, page, size)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	items := make([]taskResponse, 0, len(res.Items))
	for _, t := range res.Items {
		items = append(items, toTaskResponse(t))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "total": res.Total})
}

// Get handles GET /tasks/{taskId}.
func (h *Tasks) Get(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	t, err := h.svc.Get(r.Context(), uid, r.PathValue("taskId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toTaskResponse(t))
}

// Update handles PATCH /tasks/{taskId}. Only the listed fields are accepted; status and position
// change through /move, and project/creator can never be changed.
func (h *Tasks) Update(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Title       *string                `json:"title"`
		Description *string                `json:"description"`
		Priority    *string                `json:"priority"`
		HoldReason  *string                `json:"holdReason"`
		AssigneeIDs *[]string              `json:"assigneeIds"`
		StartDate   model.Nullable[string] `json:"startDate"`
		DueDate     model.Nullable[string] `json:"dueDate"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := h.svc.Update(r.Context(), uid, r.PathValue("taskId"), model.TaskPatch{
		Title: in.Title, Description: in.Description, Priority: in.Priority, HoldReason: in.HoldReason, AssigneeIDs: in.AssigneeIDs, StartDate: in.StartDate, DueDate: in.DueDate,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toTaskResponse(t))
}

// AddSubtask handles POST /tasks/{taskId}/subtasks.
func (h *Tasks) AddSubtask(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &in) {
		return
	}
	s, err := h.svc.AddSubtask(r.Context(), uid, r.PathValue("taskId"), in.Title)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, subtaskResponse(s))
}

// UpdateSubtask handles PATCH /tasks/{taskId}/subtasks/{subtaskId}.
func (h *Tasks) UpdateSubtask(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Title *string `json:"title"`
		Done  *bool   `json:"done"`
	}
	if !decode(w, r, &in) {
		return
	}
	s, err := h.svc.UpdateSubtask(r.Context(), uid, r.PathValue("taskId"), r.PathValue("subtaskId"),
		model.SubtaskPatch{Title: in.Title, Done: in.Done})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, subtaskResponse(s))
}

// DeleteSubtask handles DELETE /tasks/{taskId}/subtasks/{subtaskId}.
func (h *Tasks) DeleteSubtask(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteSubtask(r.Context(), uid, r.PathValue("taskId"), r.PathValue("subtaskId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Delete handles DELETE /tasks/{taskId} (moves to trash).
func (h *Tasks) Delete(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), uid, r.PathValue("taskId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Restore handles POST /tasks/{taskId}/restore.
func (h *Tasks) Restore(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	t, err := h.svc.Restore(r.Context(), uid, r.PathValue("taskId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toTaskResponse(t))
}

// Move handles POST /tasks/{taskId}/move.
func (h *Tasks) Move(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Status       string  `json:"status"`
		BeforeTaskID *string `json:"beforeTaskId"`
		HoldReason   *string `json:"holdReason"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := h.svc.Move(r.Context(), uid, r.PathValue("taskId"), in.Status, in.BeforeTaskID, in.HoldReason)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toTaskResponse(t))
}
