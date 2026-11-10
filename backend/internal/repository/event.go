package repository

import (
	"context"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// EventRepo reads and writes important days, the dated tasks shown beside them, and reminders.
// All queries are parameterized; the only SQL built from pieces uses constant fragments from this file.
type EventRepo struct{ db DBTX }

// NewEventRepo returns an EventRepo using db.
func NewEventRepo(db DBTX) *EventRepo { return &EventRepo{db: db} }

const (
	// $1 is always the person looking. A project's day is visible to its members while the project is
	// not in the trash; a personal day only to its owner.
	eventFrom    = `FROM events e LEFT JOIN projects p ON p.id = e.project_id`
	eventVisible = `(e.owner_id = $1::uuid OR (p.deleted_at IS NULL AND EXISTS (
		SELECT 1 FROM project_members m WHERE m.project_id = e.project_id AND m.user_id = $1::uuid)))`
	eventCols = `e.id::text, e.title, e.note, e.day, e.project_id::text, p.name, e.owner_id::text, e.created_by::text,
		e.remind_days,
		coalesce(e.owner_id = $1::uuid OR e.created_by = $1::uuid OR EXISTS (
			SELECT 1 FROM project_members o WHERE o.project_id = e.project_id AND o.user_id = $1::uuid AND o.role = 'owner'), false),
		e.created_at, e.updated_at`
)

func scanEvent(row scanner) (model.Event, error) {
	var ev model.Event
	var days []int32
	err := row.Scan(&ev.ID, &ev.Title, &ev.Note, &ev.Day, &ev.ProjectID, &ev.ProjectName, &ev.OwnerID, &ev.CreatedBy,
		&days, &ev.CanEdit, &ev.CreatedAt, &ev.UpdatedAt)
	ev.RemindDays = make([]int, 0, len(days))
	for _, d := range days {
		ev.RemindDays = append(ev.RemindDays, int(d))
	}
	return ev, err
}

func int32s(days []int) []int32 {
	out := make([]int32, 0, len(days))
	for _, d := range days {
		out = append(out, int32(d)) //nolint:gosec // only 0, 1, 3 or 7 get this far
	}
	return out
}

// ListEvents returns the important days userID can see between two days (both included), in day order.
func (r *EventRepo) ListEvents(ctx context.Context, userID, from, to string) ([]model.Event, error) {
	rows, err := r.db.Query(ctx, `SELECT `+eventCols+` `+eventFrom+`
		WHERE `+eventVisible+` AND e.day BETWEEN $2::date AND $3::date
		ORDER BY e.day, e.created_at, e.id`, userID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Event{}
	for rows.Next() {
		ev, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

// GetEvent returns one important day as userID sees it, or model.ErrNotFound when they cannot see it.
func (r *EventRepo) GetEvent(ctx context.Context, userID, eventID string) (model.Event, error) {
	ev, err := scanEvent(r.db.QueryRow(ctx, `SELECT `+eventCols+` `+eventFrom+`
		WHERE e.id = $2::uuid AND `+eventVisible, userID, eventID))
	return ev, mapNotFound(err)
}

// CreateEvent stores an important day made by userID: theirs, or their project's.
func (r *EventRepo) CreateEvent(ctx context.Context, userID string, in model.EventInput, at time.Time) (model.Event, error) {
	var owner *string
	if in.ProjectID == nil {
		owner = &userID
	}
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO events (title, note, day, project_id, owner_id, created_by, remind_days, created_at, updated_at)
		VALUES ($1, $2, $3::date, $4::uuid, $5::uuid, $6::uuid, $7::int[], $8, $8)
		RETURNING id::text`,
		in.Title, in.Note, in.Day.Format("2006-01-02"), in.ProjectID, owner, userID, int32s(in.RemindDays), at).Scan(&id)
	if err != nil {
		return model.Event{}, mapNotFound(err)
	}
	return r.GetEvent(ctx, userID, id)
}

// UpdateEvent changes an important day. When its day moves, the reminders already made for the old
// day are removed, so the new day can remind again.
func (r *EventRepo) UpdateEvent(ctx context.Context, eventID string, p model.EventPatch, at time.Time) error {
	var day *string
	if p.Day != nil {
		s := p.Day.Format("2006-01-02")
		day = &s
	}
	var days []int32
	if p.RemindDays != nil {
		days = int32s(*p.RemindDays)
	}
	_, err := r.db.Exec(ctx, `
		WITH old AS (
			SELECT day FROM events WHERE id = $1::uuid
		), changed AS (
			UPDATE events SET
				title = coalesce($2, title),
				note = coalesce($3, note),
				day = coalesce($4::date, day),
				remind_days = coalesce($5::int[], remind_days),
				updated_at = $6
			WHERE id = $1::uuid
			RETURNING day
		)
		DELETE FROM notifications n USING old, changed
		WHERE n.event_id = $1::uuid AND old.day <> changed.day`,
		eventID, p.Title, p.Note, day, days, at)
	return mapNotFound(err)
}

// DeleteEvent removes an important day for good, with its reminders.
func (r *EventRepo) DeleteEvent(ctx context.Context, eventID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM events WHERE id = $1::uuid`, eventID)
	return mapNotFound(err)
}

// maxCalendarTasks keeps one calendar page bounded, however many tasks there are.
const maxCalendarTasks = 500

// ListCalendarTasks returns the active tasks with a date that falls in the range, or a start and end
// on either side of it, from every active project userID is a member of.
func (r *EventRepo) ListCalendarTasks(ctx context.Context, userID, from, to string) ([]model.CalendarTask, error) {
	rows, err := r.db.Query(ctx, `
		SELECT t.id::text, t.project_id::text, p.name, t.title, t.status, t.start_date, t.due_date
		FROM tasks t
		JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
		JOIN project_members m ON m.project_id = t.project_id AND m.user_id = $1::uuid
		WHERE t.deleted_at IS NULL
		  AND coalesce(t.start_date, t.due_date) <= $3::date
		  AND coalesce(t.due_date, t.start_date) >= $2::date
		ORDER BY coalesce(t.start_date, t.due_date), t.title, t.id
		LIMIT $4`, userID, from, to, maxCalendarTasks)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.CalendarTask{}
	for rows.Next() {
		var t model.CalendarTask
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.ProjectName, &t.Title, &t.Status, &t.StartDate, &t.DueDate); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListNotifications returns userID's newest reminders that they can still see, and how many are unread.
func (r *EventRepo) ListNotifications(ctx context.Context, userID string, limit int) ([]model.Notification, int, error) {
	rows, err := r.db.Query(ctx, `
		SELECT n.id::text, e.id::text, e.title, e.day, e.project_id::text, p.name, n.days_before, n.created_at, n.read_at,
		       count(*) FILTER (WHERE n.read_at IS NULL) OVER ()
		FROM notifications n
		JOIN events e ON e.id = n.event_id
		LEFT JOIN projects p ON p.id = e.project_id
		WHERE n.user_id = $1::uuid AND `+eventVisible+`
		ORDER BY n.created_at DESC, n.id
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []model.Notification{}
	unread := 0
	for rows.Next() {
		var n model.Notification
		if err := rows.Scan(&n.ID, &n.EventID, &n.Title, &n.Day, &n.ProjectID, &n.ProjectName, &n.DaysBefore,
			&n.CreatedAt, &n.ReadAt, &unread); err != nil {
			return nil, 0, err
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if len(out) == 0 {
		return out, 0, nil
	}
	return out, unread, nil
}

// MarkRead marks userID's reminders as read: the ones listed, or all of them when ids is empty.
func (r *EventRepo) MarkRead(ctx context.Context, userID string, ids []string, at time.Time) error {
	if len(ids) == 0 {
		_, err := r.db.Exec(ctx, `UPDATE notifications SET read_at = $2
			WHERE user_id = $1::uuid AND read_at IS NULL`, userID, at)
		return err
	}
	_, err := r.db.Exec(ctx, `UPDATE notifications SET read_at = $3
		WHERE user_id = $1::uuid AND read_at IS NULL AND id = ANY ($2::uuid[])`, userID, ids, at)
	return mapNotFound(err)
}

// GenerateReminders makes every reminder that is due at now and not made yet, and says how many it made.
// A reminder for "n days before" is due at remindAt (such as "08:00") in the time zone tz, n days before
// the day, and only until the day is over. Running it twice makes nothing new: each reminder is unique.
// Who is reminded: the owner of a personal day; every member of an active project for a project's day.
func (r *EventRepo) GenerateReminders(ctx context.Context, now time.Time, tz, remindAt string) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		INSERT INTO notifications (user_id, event_id, days_before, created_at)
		SELECT who.user_id, e.id, d.days, $1
		FROM events e
		CROSS JOIN LATERAL unnest(e.remind_days) AS d(days)
		CROSS JOIN LATERAL (
			SELECT e.owner_id AS user_id WHERE e.owner_id IS NOT NULL
			UNION ALL
			SELECT m.user_id FROM project_members m JOIN projects p ON p.id = m.project_id
			WHERE m.project_id = e.project_id AND p.deleted_at IS NULL
		) who
		WHERE e.day >= ($1::timestamptz AT TIME ZONE $2)::date
		  AND (((e.day - d.days)::timestamp + $3::time) AT TIME ZONE $2) <= $1::timestamptz
		ON CONFLICT ON CONSTRAINT notifications_once DO NOTHING`, now, tz, remindAt)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
