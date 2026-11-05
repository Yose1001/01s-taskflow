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
	Delete(ctx context.Context, userID, taskID string) error
	Restore(ctx context.Context, userID, taskID string) (model.Task, error)
	Move(ctx context.Context, userID, taskID, status string, beforeTaskID *string) (model.Task, error)
}

// Tasks serves the task routes. Every route must be wrapped by middleware.Authenticate.
type Tasks struct{ svc TaskService }

// NewTasks returns the task handlers.
func NewTasks(svc TaskService) *Tasks { return &Tasks{svc: svc} }

type taskResponse struct {
	ID          string     `json:"id"`
	ProjectID   string     `json:"projectId"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	Priority    string     `json:"priority"`
	AssigneeID  *string    `json:"assigneeId"`
	CreatedBy   string     `json:"createdBy"`
	DueDate     *string    `json:"dueDate"`
	Position    float64    `json:"position"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
	PurgeAt     *time.Time `json:"purgeAt"`
}

func toTaskResponse(t model.Task) taskResponse {
	var due *string
	if t.DueDate != nil {
		s := t.DueDate.Format("2006-01-02")
		due = &s
	}
	return taskResponse{ID: t.ID, ProjectID: t.ProjectID, Title: t.Title, Description: t.Description, Status: t.Status,
		Priority: t.Priority, AssigneeID: t.AssigneeID, CreatedBy: t.CreatedBy, DueDate: due, Position: t.Position,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt, DeletedAt: t.DeletedAt, PurgeAt: t.PurgeAt}
}

// Create handles POST /projects/{projectId}/tasks.
func (h *Tasks) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Title       string  `json:"title"`
		Description string  `json:"description"`
		Status      string  `json:"status"`
		Priority    string  `json:"priority"`
		AssigneeID  *string `json:"assigneeId"`
		DueDate     *string `json:"dueDate"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := h.svc.Create(r.Context(), uid, r.PathValue("projectId"), service.TaskCreate{
		Title: in.Title, Description: in.Description, Status: in.Status, Priority: in.Priority, AssigneeID: in.AssigneeID, DueDate: in.DueDate,
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
		AssigneeID  model.Nullable[string] `json:"assigneeId"`
		DueDate     model.Nullable[string] `json:"dueDate"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := h.svc.Update(r.Context(), uid, r.PathValue("taskId"), model.TaskPatch{
		Title: in.Title, Description: in.Description, Priority: in.Priority, AssigneeID: in.AssigneeID, DueDate: in.DueDate,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toTaskResponse(t))
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
	}
	if !decode(w, r, &in) {
		return
	}
	t, err := h.svc.Move(r.Context(), uid, r.PathValue("taskId"), in.Status, in.BeforeTaskID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toTaskResponse(t))
}
