package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/httpx"
	"github.com/Yose1001/taskflow/backend/internal/middleware"
	"github.com/Yose1001/taskflow/backend/internal/model"
	"github.com/Yose1001/taskflow/backend/internal/service"
)

// ProjectService is what the project handlers need from the service layer.
type ProjectService interface {
	Create(ctx context.Context, userID, name, description string) (model.Project, error)
	List(ctx context.Context, userID string, trashed bool, page, pageSize int) (service.Page, error)
	Get(ctx context.Context, userID, projectID string) (model.Project, error)
	Update(ctx context.Context, userID, projectID string, patch model.ProjectPatch) (model.Project, error)
	Delete(ctx context.Context, userID, projectID string) error
	Restore(ctx context.Context, userID, projectID string) (model.Project, error)
	ListMembers(ctx context.Context, userID, projectID string) ([]model.Member, error)
	AddMember(ctx context.Context, userID, projectID, email string) (model.Member, error)
	RemoveMember(ctx context.Context, userID, projectID, targetUserID string) error
}

// Projects serves /projects/*. Every route must be wrapped by middleware.Authenticate.
type Projects struct{ svc ProjectService }

// NewProjects returns the project handlers.
func NewProjects(svc ProjectService) *Projects { return &Projects{svc: svc} }

type projectResponse struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	OwnerID     string     `json:"ownerId"`
	MyRole      string     `json:"myRole"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
	PurgeAt     *time.Time `json:"purgeAt"`
	TaskCount   int        `json:"taskCount"`
	DoneCount   int        `json:"doneCount"`
}

func toProjectResponse(p model.Project) projectResponse {
	return projectResponse{ID: p.ID, Name: p.Name, Description: p.Description, OwnerID: p.OwnerID, MyRole: p.MyRole,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, DeletedAt: p.DeletedAt, PurgeAt: p.PurgeAt,
		TaskCount: p.TaskCount, DoneCount: p.DoneCount}
}

type memberResponse struct {
	UserID      string    `json:"userId"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	Role        string    `json:"role"`
	JoinedAt    time.Time `json:"joinedAt"`
}

func toMemberResponse(m model.Member) memberResponse {
	return memberResponse{UserID: m.UserID, Email: m.Email, DisplayName: m.DisplayName, Role: m.Role, JoinedAt: m.JoinedAt}
}

// userID returns the authenticated user, or writes 401 and returns false.
func userID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, ok := middleware.UserID(r.Context())
	if !ok {
		writeServiceError(w, r, service.ErrUnauthorized)
	}
	return id, ok
}

// Create handles POST /projects.
func (h *Projects) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, err := h.svc.Create(r.Context(), uid, in.Name, in.Description)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toProjectResponse(p))
}

// List handles GET /projects?trashed=&page=&pageSize=.
func (h *Projects) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	fields := map[string]string{}

	trashed := false
	if v := q.Get("trashed"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil || (v != "true" && v != "false") {
			fields["trashed"] = "invalid_boolean"
		}
		trashed = b
	}
	page := intParam(q.Get("page"), "page", fields)
	size := intParam(q.Get("pageSize"), "pageSize", fields)
	if len(fields) > 0 {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_failed", "validation failed", fields)
		return
	}

	res, err := h.svc.List(r.Context(), uid, trashed, page, size)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	items := make([]projectResponse, 0, len(res.Items))
	for _, p := range res.Items {
		items = append(items, toProjectResponse(p))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "total": res.Total})
}

// intParam parses an optional integer query value (0 when absent) and records an error code if invalid.
func intParam(v, name string, fields map[string]string) int {
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		fields[name] = "invalid_number"
		return 0
	}
	return n
}

// Get handles GET /projects/{projectId}.
func (h *Projects) Get(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	p, err := h.svc.Get(r.Context(), uid, r.PathValue("projectId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toProjectResponse(p))
}

// Update handles PATCH /projects/{projectId}.
func (h *Projects) Update(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, err := h.svc.Update(r.Context(), uid, r.PathValue("projectId"), model.ProjectPatch{Name: in.Name, Description: in.Description})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toProjectResponse(p))
}

// Delete handles DELETE /projects/{projectId} (moves to trash).
func (h *Projects) Delete(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), uid, r.PathValue("projectId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Restore handles POST /projects/{projectId}/restore.
func (h *Projects) Restore(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	p, err := h.svc.Restore(r.Context(), uid, r.PathValue("projectId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toProjectResponse(p))
}

// ListMembers handles GET /projects/{projectId}/members.
func (h *Projects) ListMembers(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	members, err := h.svc.ListMembers(r.Context(), uid, r.PathValue("projectId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	out := make([]memberResponse, 0, len(members))
	for _, m := range members {
		out = append(out, toMemberResponse(m))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// AddMember handles POST /projects/{projectId}/members.
func (h *Projects) AddMember(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Email string `json:"email"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, err := h.svc.AddMember(r.Context(), uid, r.PathValue("projectId"), in.Email)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toMemberResponse(m))
}

// RemoveMember handles DELETE /projects/{projectId}/members/{userId}.
func (h *Projects) RemoveMember(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	if err := h.svc.RemoveMember(r.Context(), uid, r.PathValue("projectId"), r.PathValue("userId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
