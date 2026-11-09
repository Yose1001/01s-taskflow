-- Without the column, tasks on hold go back to "todo" and their reasons are lost.

ALTER TABLE tasks DROP CONSTRAINT tasks_hold_reason_matches_status;
ALTER TABLE tasks DROP CONSTRAINT tasks_hold_reason_len;

UPDATE tasks SET status = 'todo' WHERE status = 'on_hold';

ALTER TABLE tasks DROP CONSTRAINT tasks_status_valid;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid
    CHECK (status IN ('todo', 'in_progress', 'review', 'done'));

ALTER TABLE tasks DROP COLUMN hold_reason;
