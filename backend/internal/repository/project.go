package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// ProjectRepo reads and writes projects and their members. All queries are parameterized;
// the only SQL built with Sprintf uses constant fragments defined in this file.
type ProjectRepo struct{ db DBTX }

// NewProjectRepo returns a ProjectRepo using db.
func NewProjectRepo(db DBTX) *ProjectRepo { return &ProjectRepo{db: db} }

const (
	// The two counts are scalar sub-queries (not a join) so they can never change which rows match.
	// Both use the board index (project_id, status, position) on active tasks.
	projectCols = `p.id::text, p.name, p.description, p.owner_id::text, m.role, p.created_at, p.updated_at, p.deleted_at,
		(SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL)::int,
		(SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status = 'done')::int`
	projectFrom = `FROM projects p JOIN project_members m ON m.project_id = p.id`
)

type scanner interface{ Scan(dest ...any) error }

func scanProject(row scanner) (model.Project, error) {
	var p model.Project
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &p.MyRole, &p.CreatedAt, &p.UpdatedAt, &p.DeletedAt,
		&p.TaskCount, &p.DoneCount)
	return p, err
}

// CreateProject inserts the project and its owner membership in ONE statement (atomic).
func (r *ProjectRepo) CreateProject(ctx context.Context, ownerID, name, description string) (model.Project, error) {
	p, err := scanProject(r.db.QueryRow(ctx, `
		WITH p AS (
			INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3::uuid) RETURNING *
		), m AS (
			INSERT INTO project_members (project_id, user_id, role) SELECT id, owner_id, 'owner' FROM p
		)
		SELECT p.id::text, p.name, p.description, p.owner_id::text, 'owner'::text, p.created_at, p.updated_at, p.deleted_at,
		       0, 0
		FROM p`, name, description, ownerID))
	return p, mapNotFound(err)
}

// GetProject returns the project as seen by userID (their role included), whether active or trashed.
// It returns model.ErrNotFound when the project does not exist OR the user is not a member,
// so callers cannot tell the difference.
func (r *ProjectRepo) GetProject(ctx context.Context, projectID, userID string) (model.Project, error) {
	p, err := scanProject(r.db.QueryRow(ctx,
		`SELECT `+projectCols+` `+projectFrom+` AND m.user_id = $2::uuid WHERE p.id = $1::uuid`,
		projectID, userID))
	return p, mapNotFound(err)
}

// projectProgress is the share of a project's active tasks that are done. It is NULL when there are no tasks.
const projectProgress = `(SELECT count(*) FILTER (WHERE t.status = 'done')::float8 / NULLIF(count(*), 0)
	FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL)`

// projectOrders are the only ways to sort, as constant SQL: what the client sends only picks one of them.
// A project with no tasks has no progress to compare, so it goes last both ways.
var projectOrders = map[string]string{
	model.ProjectSortNewest:       `p.created_at DESC, p.id`,
	model.ProjectSortOldest:       `p.created_at, p.id`,
	model.ProjectSortProgressHigh: projectProgress + ` DESC NULLS LAST, p.created_at DESC, p.id`,
	model.ProjectSortProgressLow:  projectProgress + ` ASC NULLS LAST, p.created_at DESC, p.id`,
}

// ListActive returns one page of the user's non-deleted projects in the given order, and the total count.
// An order it does not know counts as the newest first.
func (r *ProjectRepo) ListActive(ctx context.Context, userID, sort string, limit, offset int) ([]model.Project, int, error) {
	order, ok := projectOrders[sort]
	if !ok {
		order = projectOrders[model.ProjectSortNewest]
	}
	return r.list(ctx, `WHERE m.user_id = $1::uuid AND p.deleted_at IS NULL`, []any{userID}, order, limit, offset)
}

// ListTrashed returns projects the user OWNS that were deleted after cutoff (still restorable).
func (r *ProjectRepo) ListTrashed(ctx context.Context, userID string, cutoff time.Time, limit, offset int) ([]model.Project, int, error) {
	return r.list(ctx,
		`WHERE m.user_id = $1::uuid AND m.role = 'owner' AND p.deleted_at IS NOT NULL AND p.deleted_at > $2`,
		[]any{userID, cutoff}, `p.deleted_at DESC, p.id`, limit, offset)
}

// list runs a paged query. where and orderBy are constant fragments from this file, never user input.
func (r *ProjectRepo) list(ctx context.Context, where string, args []any, orderBy string, limit, offset int) ([]model.Project, int, error) {
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) `+projectFrom+` `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	n := len(args)
	q := fmt.Sprintf(`SELECT %s %s %s ORDER BY %s LIMIT $%d OFFSET $%d`, projectCols, projectFrom, where, orderBy, n+1, n+2)
	rows, err := r.db.Query(ctx, q, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := []model.Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, p)
	}
	return items, total, rows.Err()
}

// UpdateProject applies the non-nil fields of patch to an ACTIVE project.
func (r *ProjectRepo) UpdateProject(ctx context.Context, projectID string, patch model.ProjectPatch, at time.Time) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE projects
		   SET name = COALESCE($2, name), description = COALESCE($3, description), updated_at = $4
		 WHERE id = $1::uuid AND deleted_at IS NULL`,
		projectID, patch.Name, patch.Description, at)
	return noRowsIsNotFound(tag.RowsAffected(), err)
}

// SoftDeleteProject moves an active project to the trash.
func (r *ProjectRepo) SoftDeleteProject(ctx context.Context, projectID, deletedBy string, at time.Time) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE projects SET deleted_at = $2, deleted_by = $3::uuid, updated_at = $2
		 WHERE id = $1::uuid AND deleted_at IS NULL`,
		projectID, at, deletedBy)
	return noRowsIsNotFound(tag.RowsAffected(), err)
}

// RestoreProject takes a project out of the trash if it was deleted after cutoff.
func (r *ProjectRepo) RestoreProject(ctx context.Context, projectID string, at, cutoff time.Time) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE projects SET deleted_at = NULL, deleted_by = NULL, updated_at = $2
		 WHERE id = $1::uuid AND deleted_at IS NOT NULL AND deleted_at > $3`,
		projectID, at, cutoff)
	return noRowsIsNotFound(tag.RowsAffected(), err)
}

// ListMembers returns everyone in the project, oldest member first.
func (r *ProjectRepo) ListMembers(ctx context.Context, projectID string) ([]model.Member, error) {
	rows, err := r.db.Query(ctx, `
		SELECT m.user_id::text, u.email, u.display_name, m.role, m.joined_at
		  FROM project_members m JOIN users u ON u.id = m.user_id
		 WHERE m.project_id = $1::uuid
		 ORDER BY m.joined_at, u.email`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []model.Member{}
	for rows.Next() {
		var m model.Member
		if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role, &m.JoinedAt); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// GetMemberRole returns a user's role in a project, or model.ErrNotFound.
func (r *ProjectRepo) GetMemberRole(ctx context.Context, projectID, userID string) (string, error) {
	var role string
	err := r.db.QueryRow(ctx,
		`SELECT role FROM project_members WHERE project_id = $1::uuid AND user_id = $2::uuid`,
		projectID, userID).Scan(&role)
	return role, mapNotFound(err)
}

// AddMember adds userID as a regular member. Returns model.ErrAlreadyMember if already in the project.
// ON CONFLICT is used (instead of catching an error) so a duplicate never aborts a surrounding transaction.
func (r *ProjectRepo) AddMember(ctx context.Context, projectID, userID string) (time.Time, error) {
	var joined time.Time
	err := r.db.QueryRow(ctx, `
		INSERT INTO project_members (project_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member')
		ON CONFLICT DO NOTHING RETURNING joined_at`, projectID, userID).Scan(&joined)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, model.ErrAlreadyMember
	}
	return joined, err
}

// RemoveMember removes a non-owner member. Tasks assigned to them are unassigned by the schema (ON DELETE SET NULL).
func (r *ProjectRepo) RemoveMember(ctx context.Context, projectID, userID string) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM project_members WHERE project_id = $1::uuid AND user_id = $2::uuid AND role <> 'owner'`,
		projectID, userID)
	return noRowsIsNotFound(tag.RowsAffected(), err)
}

func noRowsIsNotFound(affected int64, err error) error {
	if err != nil {
		return mapNotFound(err)
	}
	if affected == 0 {
		return model.ErrNotFound
	}
	return nil
}
