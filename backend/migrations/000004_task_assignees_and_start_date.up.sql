-- A task can have several assignees, and a start date. due_date stays: it is the task's end date.

ALTER TABLE tasks ADD COLUMN start_date date;
ALTER TABLE tasks ADD CONSTRAINT tasks_start_not_after_due
    CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);

-- Lets task_assignees prove that the task and the member belong to the same project.
ALTER TABLE tasks ADD CONSTRAINT tasks_id_project_unique UNIQUE (id, project_id);

CREATE TABLE task_assignees (
    task_id    uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id    uuid NOT NULL,
    PRIMARY KEY (task_id, user_id),
    CONSTRAINT task_assignees_task FOREIGN KEY (task_id, project_id)
        REFERENCES tasks (id, project_id) ON DELETE CASCADE,
    -- An assignee must be a member of the project. Removing the member removes only the assignment.
    CONSTRAINT task_assignees_is_member FOREIGN KEY (project_id, user_id)
        REFERENCES project_members (project_id, user_id) ON DELETE CASCADE
);

-- For "tasks assigned to this person" and for removing a member.
CREATE INDEX task_assignees_member_idx ON task_assignees (project_id, user_id);

INSERT INTO task_assignees (task_id, project_id, user_id)
SELECT id, project_id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL;

ALTER TABLE tasks DROP CONSTRAINT tasks_assignee_is_member;
DROP INDEX tasks_assignee_idx;
ALTER TABLE tasks DROP COLUMN assignee_id;
