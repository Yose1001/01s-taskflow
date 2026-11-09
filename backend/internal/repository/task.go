package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// positionStep is the gap between neighbouring tasks when positions are (re)assigned.
const positionStep = 1024.0

// TaskRepo reads and writes tasks. All values go through query parameters; the only SQL
// assembled with Sprintf/concatenation uses constant fragments defined in this file.
type TaskRepo struct{ db DBTX }

// NewTaskRepo returns a TaskRepo using db.
func NewTaskRepo(db DBTX) *TaskRepo { return &TaskRepo{db: db} }

const (
	taskBaseCols = `t.id::text, t.project_id::text, t.title, t.description, t.status, t.priority, t.hold_reason,
	t.created_by::text, t.start_date, t.due_date, t.position, t.created_at, t.updated_at, t.deleted_at`
	// Ordered by uuid, so a task always lists its assignees the same way.
	taskCols = taskBaseCols + `,
	ARRAY(SELECT a.user_id::text FROM task_assignees a WHERE a.task_id = t.id ORDER BY a.user_id),
	COALESCE((SELECT json_agg(` + subtaskJSON + ` ORDER BY s.position, s.id) FROM task_subtasks s WHERE s.task_id = t.id), '[]'::json)`

	subtaskJSON = `json_build_object('id', s.id, 'title', s.title, 'done', s.done)`
)

func scanTask(row scanner) (model.Task, error) {
	var t model.Task
	err := row.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Description, &t.Status, &t.Priority, &t.HoldReason,
		&t.CreatedBy, &t.StartDate, &t.DueDate, &t.Position, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt, &t.AssigneeIDs, &t.Subtasks)
	return t, err
}

// CreateTask inserts a task at the END of its status column, with its assignees and subtasks, in one
// statement. Assignees must already be sorted: the rows it inserts cannot be read back within the statement.
func (r *TaskRepo) CreateTask(ctx context.Context, projectID, createdBy string, in model.TaskInput) (model.Task, error) {
	t, err := scanTask(r.db.QueryRow(ctx, `
		WITH t AS (
			INSERT INTO tasks (project_id, title, description, status, priority, hold_reason, created_by, start_date, due_date, position)
			VALUES ($1::uuid, $2, $3, $4, $5, $11::text, $6::uuid, $7::date, $8::date,
				COALESCE((SELECT max(position) FROM tasks
				           WHERE project_id = $1::uuid AND status = $4 AND deleted_at IS NULL), 0) + `+fmt.Sprint(positionStep)+`)
			RETURNING *
		), linked AS (
			INSERT INTO task_assignees (task_id, project_id, user_id)
			SELECT t.id, t.project_id, u::uuid FROM t, unnest($9::text[]) u
		), s AS (
			INSERT INTO task_subtasks (task_id, title, position)
			SELECT t.id, x.title, x.n * `+fmt.Sprint(positionStep)+` FROM t, unnest($10::text[]) WITH ORDINALITY AS x(title, n)
			RETURNING id, title, done, position
		)
		SELECT `+taskBaseCols+`, $9::text[],
			COALESCE((SELECT json_agg(`+subtaskJSON+` ORDER BY s.position) FROM s), '[]'::json)
		FROM t`,
		projectID, in.Title, in.Description, in.Status, in.Priority, createdBy, in.StartDate, in.DueDate,
		notNil(in.AssigneeIDs), notNil(in.Subtasks), in.HoldReason))
	return t, mapNotFound(err)
}

// notNil turns a nil list into an empty one: in SQL, NULL and an empty array behave differently.
func notNil(ids []string) []string {
	if ids == nil {
		return []string{}
	}
	return ids
}

// GetTask returns the task (active OR trashed) as seen by userID. It returns model.ErrNotFound when the
// task does not exist, the user is not a member of its project, or the project is in the trash.
func (r *TaskRepo) GetTask(ctx context.Context, taskID, userID string) (model.Task, error) {
	t, err := scanTask(r.db.QueryRow(ctx, `
		SELECT `+taskCols+`
		  FROM tasks t
		  JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
		  JOIN project_members m ON m.project_id = p.id AND m.user_id = $2::uuid
		 WHERE t.id = $1::uuid`, taskID, userID))
	return t, mapNotFound(err)
}

// ListTasks returns a page of a project's tasks and the total matching count.
func (r *TaskRepo) ListTasks(ctx context.Context, projectID string, f model.TaskFilter, limit, offset int) ([]model.Task, int, error) {
	where := []string{"t.project_id = $1::uuid"}
	args := []any{projectID}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}

	// position is only meaningful inside one column, so order by column first for a stable board order.
	order := `CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'review' THEN 2 WHEN 'on_hold' THEN 3 ELSE 4 END, t.position, t.id`
	if f.Trashed {
		add("t.deleted_at IS NOT NULL AND t.deleted_at > $%d", f.Cutoff)
		order = "t.deleted_at DESC, t.id"
	} else {
		where = append(where, "t.deleted_at IS NULL")
	}
	if f.Status != "" {
		add("t.status = $%d", f.Status)
	}
	if f.Priority != "" {
		add("t.priority = $%d", f.Priority)
	}
	if f.AssigneeID != "" {
		add("EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $%d::uuid)", f.AssigneeID)
	}
	if f.Query != "" {
		add(`t.title ILIKE $%d ESCAPE '\'`, "%"+escapeLike(f.Query)+"%")
	}
	cond := "WHERE " + strings.Join(where, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM tasks t `+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	n := len(args)
	q := fmt.Sprintf(`SELECT %s FROM tasks t %s ORDER BY %s LIMIT $%d OFFSET $%d`, taskCols, cond, order, n+1, n+2)
	rows, err := r.db.Query(ctx, q, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := []model.Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, t)
	}
	return items, total, rows.Err()
}

// escapeLike makes %, _ and \ in user input match literally inside an ILIKE pattern.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// UpdateTask applies a change set to an ACTIVE task, and its new assignees, in one statement.
func (r *TaskRepo) UpdateTask(ctx context.Context, taskID string, u model.TaskUpdate, at time.Time) error {
	var updated int64
	err := r.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE tasks SET
				title       = COALESCE($2, title),
				description = COALESCE($3, description),
				priority    = COALESCE($4, priority),
				hold_reason = COALESCE($12::text, hold_reason),
				start_date  = CASE WHEN $5::boolean THEN $6::date ELSE start_date END,
				due_date    = CASE WHEN $7::boolean THEN $8::date ELSE due_date END,
				updated_at  = $9
			WHERE id = $1::uuid AND deleted_at IS NULL
			RETURNING id, project_id
		), removed AS (
			DELETE FROM task_assignees a USING updated u
			 WHERE $10::boolean AND a.task_id = u.id AND NOT (a.user_id::text = ANY($11::text[]))
		), added AS (
			INSERT INTO task_assignees (task_id, project_id, user_id)
			SELECT u.id, u.project_id, v::uuid FROM updated u, unnest($11::text[]) v WHERE $10::boolean
			ON CONFLICT (task_id, user_id) DO NOTHING
		)
		SELECT count(*) FROM updated`,
		taskID, u.Title, u.Description, u.Priority, u.SetStartDate, u.StartDate, u.SetDueDate, u.DueDate, at,
		u.SetAssignees, notNil(u.AssigneeIDs), u.HoldReason).Scan(&updated)
	return noRowsIsNotFound(updated, err)
}

// CreateSubtask adds a subtask at the end of an ACTIVE task's list.
func (r *TaskRepo) CreateSubtask(ctx context.Context, taskID, title string, at time.Time) (model.Subtask, error) {
	var s model.Subtask
	err := r.db.QueryRow(ctx, `
		WITH touched AS (
			UPDATE tasks SET updated_at = $3 WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id
		)
		INSERT INTO task_subtasks (task_id, title, position)
		SELECT touched.id, $2::text,
			COALESCE((SELECT max(position) FROM task_subtasks WHERE task_id = $1::uuid), 0) + `+fmt.Sprint(positionStep)+`
		  FROM touched
		RETURNING id::text, title, done`, taskID, title, at).Scan(&s.ID, &s.Title, &s.Done)
	return s, mapNotFound(err)
}

// UpdateSubtask changes a subtask of the given task.
func (r *TaskRepo) UpdateSubtask(ctx context.Context, taskID, subtaskID string, p model.SubtaskPatch, at time.Time) (model.Subtask, error) {
	var s model.Subtask
	err := r.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE task_subtasks SET
				title      = COALESCE($3::text, title),
				done       = COALESCE($4::boolean, done),
				updated_at = $5::timestamptz
			WHERE id = $1::uuid AND task_id = $2::uuid
			RETURNING id::text, title, done
		), touched AS (
			UPDATE tasks SET updated_at = $5::timestamptz
			 WHERE id = $2::uuid AND EXISTS (SELECT 1 FROM updated)
		)
		SELECT id, title, done FROM updated`, subtaskID, taskID, p.Title, p.Done, at).Scan(&s.ID, &s.Title, &s.Done)
	return s, mapNotFound(err)
}

// DeleteSubtask removes a subtask of the given task for good: subtasks have no trash of their own.
func (r *TaskRepo) DeleteSubtask(ctx context.Context, taskID, subtaskID string, at time.Time) error {
	var removed int64
	err := r.db.QueryRow(ctx, `
		WITH removed AS (
			DELETE FROM task_subtasks WHERE id = $1::uuid AND task_id = $2::uuid RETURNING 1
		), touched AS (
			UPDATE tasks SET updated_at = $3::timestamptz
			 WHERE id = $2::uuid AND EXISTS (SELECT 1 FROM removed)
		)
		SELECT count(*) FROM removed`, subtaskID, taskID, at).Scan(&removed)
	return noRowsIsNotFound(removed, err)
}

// SoftDeleteTask moves an active task to the trash.
func (r *TaskRepo) SoftDeleteTask(ctx context.Context, taskID, deletedBy string, at time.Time) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE tasks SET deleted_at = $2, deleted_by = $3::uuid, updated_at = $2
		 WHERE id = $1::uuid AND deleted_at IS NULL`, taskID, at, deletedBy)
	return noRowsIsNotFound(tag.RowsAffected(), err)
}

// RestoreTask takes a task out of the trash if it was deleted after cutoff. Its column and position are kept.
// Assignees who left the project meanwhile are already gone: the schema removed them with the member.
func (r *TaskRepo) RestoreTask(ctx context.Context, taskID string, at, cutoff time.Time) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, updated_at = $2
		 WHERE id = $1::uuid AND deleted_at IS NOT NULL AND deleted_at > $3`, taskID, at, cutoff)
	return noRowsIsNotFound(tag.RowsAffected(), err)
}

// BeforePosition returns the position of an active task in the given column, or model.ErrNotFound.
func (r *TaskRepo) BeforePosition(ctx context.Context, projectID, status, beforeTaskID string) (float64, error) {
	var pos float64
	err := r.db.QueryRow(ctx, `
		SELECT position FROM tasks
		 WHERE id = $1::uuid AND project_id = $2::uuid AND status = $3 AND deleted_at IS NULL`,
		beforeTaskID, projectID, status).Scan(&pos)
	return pos, mapNotFound(err)
}

// MaxPositionBelow returns the largest position in a column (excluding one task), optionally only
// those strictly below `below`. It returns nil when there is none.
func (r *TaskRepo) MaxPositionBelow(ctx context.Context, projectID, status, excludeTaskID string, below *float64) (*float64, error) {
	var pos *float64
	err := r.db.QueryRow(ctx, `
		SELECT max(position) FROM tasks
		 WHERE project_id = $1::uuid AND status = $2 AND deleted_at IS NULL
		   AND id <> $3::uuid AND ($4::double precision IS NULL OR position < $4)`,
		projectID, status, excludeTaskID, below).Scan(&pos)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return pos, err
}

// RebalanceColumn renumbers a column with even gaps, keeping the current order.
func (r *TaskRepo) RebalanceColumn(ctx context.Context, projectID, status string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE tasks t SET position = r.rn * `+fmt.Sprint(positionStep)+`
		  FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS rn
		          FROM tasks
		         WHERE project_id = $1::uuid AND status = $2 AND deleted_at IS NULL) r
		 WHERE t.id = r.id`, projectID, status)
	return err
}

// MoveTask sets the task's column and position. A task on hold keeps its reason unless it is given a new
// one, and any other column clears it.
func (r *TaskRepo) MoveTask(ctx context.Context, taskID, status string, position float64, holdReason *string, at time.Time) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE tasks SET status = $2, position = $3, updated_at = $4,
			hold_reason = CASE WHEN $2 = '`+model.StatusOnHold+`' THEN COALESCE($5::text, hold_reason) END
		 WHERE id = $1::uuid AND deleted_at IS NULL`, taskID, status, position, at, holdReason)
	return noRowsIsNotFound(tag.RowsAffected(), err)
}
