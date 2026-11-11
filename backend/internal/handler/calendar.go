package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/httpx"
	"github.com/Yose1001/taskflow/backend/internal/model"
	"github.com/Yose1001/taskflow/backend/internal/service"
)

// CalendarService is what the calendar handlers need from the service layer.
type CalendarService interface {
	Range(ctx context.Context, userID, from, to string) (service.CalendarPage, error)
	Create(ctx context.Context, userID string, in service.EventCreate) (model.Event, error)
	Update(ctx context.Context, userID, eventID string, in service.EventUpdate) (model.Event, error)
	Delete(ctx context.Context, userID, eventID string) error
	Notifications(ctx context.Context, userID string) ([]model.Notification, int, error)
	MarkRead(ctx context.Context, userID string, ids []string) error
	People(ctx context.Context, userID string) ([]model.Person, error)
}

// Calendar serves the calendar, important-day and notification routes. Every route must be wrapped
// by middleware.Authenticate.
type Calendar struct{ svc CalendarService }

// NewCalendar returns the calendar handlers.
func NewCalendar(svc CalendarService) *Calendar { return &Calendar{svc: svc} }

type eventResponse struct {
	ID            string           `json:"id"`
	Title         string           `json:"title"`
	Note          string           `json:"note"`
	Day           string           `json:"day"`
	ProjectID     *string          `json:"projectId"`
	ProjectName   *string          `json:"projectName"`
	OwnerID       *string          `json:"ownerId"`
	CreatedBy     string           `json:"createdBy"`
	RemindDays    []int            `json:"remindDays"`
	AtTime        *string          `json:"atTime"`
	RemindMinutes []int            `json:"remindMinutes"`
	SharedWith    []personResponse `json:"sharedWith"`
	SharedBy      *string          `json:"sharedBy"`
	CanEdit       bool             `json:"canEdit"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
}

type personResponse struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
}

func toPeople(list []model.Person) []personResponse {
	out := make([]personResponse, 0, len(list))
	for _, p := range list {
		out = append(out, personResponse(p))
	}
	return out
}

func toEventResponse(e model.Event) eventResponse {
	days := e.RemindDays
	if days == nil {
		days = []int{}
	}
	minutes := e.RemindMinutes
	if minutes == nil {
		minutes = []int{}
	}
	return eventResponse{ID: e.ID, Title: e.Title, Note: e.Note, Day: e.Day.Format("2006-01-02"), ProjectID: e.ProjectID,
		ProjectName: e.ProjectName, OwnerID: e.OwnerID, CreatedBy: e.CreatedBy, RemindDays: days, SharedWith: toPeople(e.SharedWith), AtTime: e.AtTime, RemindMinutes: minutes,
		SharedBy: e.SharedBy, CanEdit: e.CanEdit,
		CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt}
}

type calendarTaskResponse struct {
	ID          string   `json:"id"`
	ProjectID   string   `json:"projectId"`
	ProjectName string   `json:"projectName"`
	Title       string   `json:"title"`
	Status      string   `json:"status"`
	StartDate   *string  `json:"startDate"`
	DueDate     *string  `json:"dueDate"`
	AssigneeIDs []string `json:"assigneeIds"`
}

type notificationResponse struct {
	ID            string     `json:"id"`
	EventID       string     `json:"eventId"`
	Title         string     `json:"title"`
	Day           string     `json:"day"`
	ProjectID     *string    `json:"projectId"`
	ProjectName   *string    `json:"projectName"`
	SharedBy      *string    `json:"sharedBy"`
	DaysBefore    int        `json:"daysBefore"`
	MinutesBefore int        `json:"minutesBefore"`
	AtTime        *string    `json:"atTime"`
	CreatedAt     time.Time  `json:"createdAt"`
	ReadAt        *time.Time `json:"readAt"`
}

// Range handles GET /calendar?from=YYYY-MM-DD&to=YYYY-MM-DD.
func (h *Calendar) Range(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	page, err := h.svc.Range(r.Context(), uid, q.Get("from"), q.Get("to"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	events := make([]eventResponse, 0, len(page.Events))
	for _, e := range page.Events {
		events = append(events, toEventResponse(e))
	}
	tasks := make([]calendarTaskResponse, 0, len(page.Tasks))
	for _, t := range page.Tasks {
		tasks = append(tasks, calendarTaskResponse{ID: t.ID, ProjectID: t.ProjectID, ProjectName: t.ProjectName,
			Title: t.Title, Status: t.Status, StartDate: dateString(t.StartDate), DueDate: dateString(t.DueDate),
			AssigneeIDs: t.AssigneeIDs})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"events": events, "tasks": tasks})
}

// CreateEvent handles POST /events.
func (h *Calendar) CreateEvent(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Title         string   `json:"title"`
		Note          string   `json:"note"`
		Day           string   `json:"day"`
		ProjectID     *string  `json:"projectId"`
		SharedWith    []string `json:"sharedWith"`
		RemindDays    []int    `json:"remindDays"`
		AtTime        *string  `json:"atTime"`
		RemindMinutes []int    `json:"remindMinutes"`
	}
	if !decode(w, r, &in) {
		return
	}
	ev, err := h.svc.Create(r.Context(), uid, service.EventCreate{
		Title: in.Title, Note: in.Note, Day: in.Day, ProjectID: in.ProjectID, SharedWith: in.SharedWith,
		RemindDays: in.RemindDays, AtTime: in.AtTime, RemindMinutes: in.RemindMinutes,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toEventResponse(ev))
}

// UpdateEvent handles PATCH /events/{eventId}.
func (h *Calendar) UpdateEvent(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		Title         *string   `json:"title"`
		Note          *string   `json:"note"`
		Day           *string   `json:"day"`
		RemindDays    *[]int    `json:"remindDays"`
		SharedWith    *[]string `json:"sharedWith"`
		AtTime        *string   `json:"atTime"`
		RemindMinutes *[]int    `json:"remindMinutes"`
	}
	if !decode(w, r, &in) {
		return
	}
	ev, err := h.svc.Update(r.Context(), uid, r.PathValue("eventId"), service.EventUpdate{
		Title: in.Title, Note: in.Note, Day: in.Day, RemindDays: in.RemindDays, SharedWith: in.SharedWith,
		AtTime: in.AtTime, RemindMinutes: in.RemindMinutes,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toEventResponse(ev))
}

// DeleteEvent handles DELETE /events/{eventId}.
func (h *Calendar) DeleteEvent(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), uid, r.PathValue("eventId")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// People handles GET /people: who the person may share an important day with.
func (h *Calendar) People(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	people, err := h.svc.People(r.Context(), uid)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": toPeople(people)})
}

// Notifications handles GET /notifications.
func (h *Calendar) Notifications(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	list, unread, err := h.svc.Notifications(r.Context(), uid)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	items := make([]notificationResponse, 0, len(list))
	for _, n := range list {
		items = append(items, notificationResponse{ID: n.ID, EventID: n.EventID, Title: n.Title,
			Day: n.Day.Format("2006-01-02"), ProjectID: n.ProjectID, ProjectName: n.ProjectName, SharedBy: n.SharedBy,
			DaysBefore: n.DaysBefore, MinutesBefore: n.MinutesBefore, AtTime: n.AtTime, CreatedAt: n.CreatedAt,
			ReadAt: n.ReadAt})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "unread": unread})
}

// MarkRead handles POST /notifications/read with {"ids": [...]}; no ids (or none sent) marks them all.
func (h *Calendar) MarkRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := userID(w, r)
	if !ok {
		return
	}
	var in struct {
		IDs []string `json:"ids"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.svc.MarkRead(r.Context(), uid, in.IDs); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
