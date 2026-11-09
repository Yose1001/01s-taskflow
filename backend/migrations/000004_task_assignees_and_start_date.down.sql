-- Going back to one assignee per task keeps only the first assignee of each task, and start dates are lost.

ALTER TABLE tasks ADD COLUMN assignee_id uuid;

UPDATE tasks t
   SET assignee_id = (SELECT a.user_id FROM task_assignees a WHERE a.task_id = t.id ORDER BY a.user_id LIMIT 1);

ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_is_member FOREIGN KEY (project_id, assignee_id)
    REFERENCES project_members (project_id, user_id) ON DELETE SET NULL (assignee_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id) WHERE deleted_at IS NULL;

DROP TABLE task_assignees;

ALTER TABLE tasks DROP CONSTRAINT tasks_id_project_unique;
ALTER TABLE tasks DROP CONSTRAINT tasks_start_not_after_due;
ALTER TABLE tasks DROP COLUMN start_date;
