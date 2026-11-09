-- A fifth column for work that is paused, and why. A task on hold always says why; no other task has a reason.

ALTER TABLE tasks ADD COLUMN hold_reason text;

ALTER TABLE tasks DROP CONSTRAINT tasks_status_valid;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid
    CHECK (status IN ('todo', 'in_progress', 'review', 'on_hold', 'done'));

ALTER TABLE tasks ADD CONSTRAINT tasks_hold_reason_matches_status
    CHECK ((status = 'on_hold') = (hold_reason IS NOT NULL));
ALTER TABLE tasks ADD CONSTRAINT tasks_hold_reason_len
    CHECK (hold_reason IS NULL OR char_length(hold_reason) BETWEEN 1 AND 500);
