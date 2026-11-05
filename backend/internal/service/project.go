package service

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// ErrForbidden means the user can see the project but lacks the role for this action (HTTP 403).
// A user who is NOT a member never gets this: they get model.ErrNotFound (HTTP 404),
// so the existence of other people's projects is not revealed.
var ErrForbidden = errors.New("forbidden")

const (
	maxProjectNameLen = 120
	maxProjectDescLen = 2000
	defaultPageSize   = 20
	maxPageSize       = 100
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ProjectStore is the persistence the project service needs (implemented by repository.ProjectRepo).
type ProjectStore interface {
	CreateProject(ctx context.Context, ownerID, name, description string) (model.Project, error)
	GetProject(ctx context.Context, projectID, userID string) (model.Project, error)
	ListActive(ctx context.Context, userID string, limit, offset int) ([]model.Project, int, error)
	ListTrashed(ctx context.Context, userID string, cutoff time.Time, limit, offset int) ([]model.Project, int, error)
	UpdateProject(ctx context.Context, projectID string, patch model.ProjectPatch, at time.Time) error
	SoftDeleteProject(ctx context.Context, projectID, deletedBy string, at time.Time) error
	RestoreProject(ctx context.Context, projectID string, at, cutoff time.Time) error
	ListMembers(ctx context.Context, projectID string) ([]model.Member, error)
	GetMemberRole(ctx context.Context, projectID, userID string) (string, error)
	AddMember(ctx context.Context, projectID, userID string) (time.Time, error)
	RemoveMember(ctx context.Context, projectID, userID string) error
}

// UserLookup finds users by email (implemented by repository.UserRepo).
type UserLookup interface {
	GetByEmail(ctx context.Context, email string) (model.User, error)
}

// ProjectOption customises Projects (used by tests).
type ProjectOption func(*Projects)

// WithProjectsClock overrides the clock (used to test trash expiry).
func WithProjectsClock(now func() time.Time) ProjectOption { return func(p *Projects) { p.now = now } }

// Projects implements project and membership rules.
//
// Permission rules, enforced here and nowhere else:
//   - not a member (or project in trash, or unknown/malformed id) -> model.ErrNotFound (404)
//   - member, but action needs the owner                          -> ErrForbidden (403)
type Projects struct {
	store     ProjectStore
	users     UserLookup
	retention time.Duration
	now       func() time.Time
}

// NewProjects builds the service. retentionDays is how long deleted projects stay restorable.
func NewProjects(store ProjectStore, users UserLookup, retentionDays int, opts ...ProjectOption) *Projects {
	p := &Projects{store: store, users: users, retention: time.Duration(retentionDays) * 24 * time.Hour, now: time.Now}
	for _, o := range opts {
		o(p)
	}
	return p
}

// Page is a page of results with the overall total.
type Page struct {
	Items []model.Project
	Total int
}

// Create makes a new project owned by userID.
func (s *Projects) Create(ctx context.Context, userID, name, description string) (model.Project, error) {
	name = strings.TrimSpace(name)
	if fields := validateProjectFields(&name, &description); len(fields) > 0 {
		return model.Project{}, &ValidationError{Fields: fields}
	}
	return s.store.CreateProject(ctx, userID, name, description)
}

// List returns the user's active projects, or (trashed=true) the projects they own that can still be restored.
func (s *Projects) List(ctx context.Context, userID string, trashed bool, page, pageSize int) (Page, error) {
	limit, offset := paging(page, pageSize)
	var (
		items []model.Project
		total int
		err   error
	)
	if trashed {
		items, total, err = s.store.ListTrashed(ctx, userID, s.cutoff(), limit, offset)
	} else {
		items, total, err = s.store.ListActive(ctx, userID, limit, offset)
	}
	if err != nil {
		return Page{}, err
	}
	for i := range items {
		items[i] = s.withPurge(items[i])
	}
	return Page{Items: items, Total: total}, nil
}

// Get returns an active project the user belongs to.
func (s *Projects) Get(ctx context.Context, userID, projectID string) (model.Project, error) {
	return s.active(ctx, userID, projectID)
}

// Update changes name/description. Owner only.
func (s *Projects) Update(ctx context.Context, userID, projectID string, patch model.ProjectPatch) (model.Project, error) {
	p, err := s.active(ctx, userID, projectID)
	if err != nil {
		return model.Project{}, err
	}
	if p.MyRole != model.RoleOwner {
		return model.Project{}, ErrForbidden
	}

	fields := map[string]string{}
	if patch.Name == nil && patch.Description == nil {
		fields["body"] = "nothing_to_update"
	}
	if patch.Name != nil {
		n := strings.TrimSpace(*patch.Name)
		patch.Name = &n
		if code := validateProjectName(n); code != "" {
			fields["name"] = code
		}
	}
	if patch.Description != nil && utf8.RuneCountInString(*patch.Description) > maxProjectDescLen {
		fields["description"] = "description_too_long"
	}
	if len(fields) > 0 {
		return model.Project{}, &ValidationError{Fields: fields}
	}

	if err := s.store.UpdateProject(ctx, projectID, patch, s.now()); err != nil {
		return model.Project{}, err
	}
	return s.active(ctx, userID, projectID)
}

// Delete moves the project to the trash. Owner only.
func (s *Projects) Delete(ctx context.Context, userID, projectID string) error {
	p, err := s.active(ctx, userID, projectID)
	if err != nil {
		return err
	}
	if p.MyRole != model.RoleOwner {
		return ErrForbidden
	}
	return s.store.SoftDeleteProject(ctx, projectID, userID, s.now())
}

// Restore takes a project out of the trash. Owner only, and only within the retention period.
func (s *Projects) Restore(ctx context.Context, userID, projectID string) (model.Project, error) {
	if !uuidRe.MatchString(projectID) {
		return model.Project{}, model.ErrNotFound
	}
	p, err := s.store.GetProject(ctx, projectID, userID)
	if err != nil {
		return model.Project{}, err // not a member -> 404
	}
	if p.DeletedAt == nil {
		return model.Project{}, model.ErrNotFound // not in the trash
	}
	if p.MyRole != model.RoleOwner {
		return model.Project{}, ErrForbidden
	}
	if !p.DeletedAt.After(s.cutoff()) {
		return model.Project{}, model.ErrNotFound // retention period is over
	}
	if err := s.store.RestoreProject(ctx, projectID, s.now(), s.cutoff()); err != nil {
		return model.Project{}, err
	}
	return s.active(ctx, userID, projectID)
}

// ListMembers lists the project's members. Any member may call it.
func (s *Projects) ListMembers(ctx context.Context, userID, projectID string) ([]model.Member, error) {
	if _, err := s.active(ctx, userID, projectID); err != nil {
		return nil, err
	}
	return s.store.ListMembers(ctx, projectID)
}

// AddMember invites an existing user by email. Owner only.
func (s *Projects) AddMember(ctx context.Context, userID, projectID, email string) (model.Member, error) {
	p, err := s.active(ctx, userID, projectID)
	if err != nil {
		return model.Member{}, err
	}
	if p.MyRole != model.RoleOwner {
		return model.Member{}, ErrForbidden
	}

	email = NormalizeEmail(email)
	if code := validateEmail(email); code != "" {
		return model.Member{}, &ValidationError{Fields: map[string]string{"email": code}}
	}
	u, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		return model.Member{}, err // unknown email -> model.ErrNotFound
	}
	joined, err := s.store.AddMember(ctx, projectID, u.ID)
	if err != nil {
		return model.Member{}, err // model.ErrAlreadyMember -> 409
	}
	return model.Member{UserID: u.ID, Email: u.Email, DisplayName: u.DisplayName, Role: model.RoleMember, JoinedAt: joined}, nil
}

// RemoveMember removes a member. Owner only. The owner themself cannot be removed.
func (s *Projects) RemoveMember(ctx context.Context, userID, projectID, targetUserID string) error {
	p, err := s.active(ctx, userID, projectID)
	if err != nil {
		return err
	}
	if p.MyRole != model.RoleOwner {
		return ErrForbidden
	}
	if !uuidRe.MatchString(targetUserID) {
		return model.ErrNotFound
	}
	role, err := s.store.GetMemberRole(ctx, projectID, targetUserID)
	if err != nil {
		return err // not a member -> 404
	}
	if role == model.RoleOwner {
		return &ValidationError{Fields: map[string]string{"userId": "cannot_remove_owner"}}
	}
	return s.store.RemoveMember(ctx, projectID, targetUserID)
}

// active loads a project the user belongs to and that is not in the trash.
func (s *Projects) active(ctx context.Context, userID, projectID string) (model.Project, error) {
	if !uuidRe.MatchString(projectID) {
		return model.Project{}, model.ErrNotFound
	}
	p, err := s.store.GetProject(ctx, projectID, userID)
	if err != nil {
		return model.Project{}, err
	}
	if p.DeletedAt != nil {
		return model.Project{}, model.ErrNotFound
	}
	return p, nil
}

func (s *Projects) cutoff() time.Time { return s.now().Add(-s.retention) }

func (s *Projects) withPurge(p model.Project) model.Project {
	if p.DeletedAt != nil {
		purge := p.DeletedAt.Add(s.retention)
		p.PurgeAt = &purge
	}
	return p
}

func paging(page, size int) (limit, offset int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = defaultPageSize
	}
	if size > maxPageSize {
		size = maxPageSize
	}
	return size, (page - 1) * size
}

func validateProjectFields(name, description *string) map[string]string {
	fields := map[string]string{}
	if code := validateProjectName(*name); code != "" {
		fields["name"] = code
	}
	if utf8.RuneCountInString(*description) > maxProjectDescLen {
		fields["description"] = "description_too_long"
	}
	return fields
}

func validateProjectName(name string) string {
	n := utf8.RuneCountInString(name)
	if n < 1 || n > maxProjectNameLen {
		return "invalid_name"
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "invalid_name"
		}
	}
	return ""
}
