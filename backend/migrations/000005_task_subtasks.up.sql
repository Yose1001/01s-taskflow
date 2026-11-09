-- A task can be broken down into a list of smaller things to do, each ticked off on its own.

CREATE TABLE task_subtasks (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    uuid             NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    title      text             NOT NULL,
    done       boolean          NOT NULL DEFAULT false,
    position   double precision NOT NULL,
    created_at timestamptz      NOT NULL DEFAULT now(),
    updated_at timestamptz      NOT NULL DEFAULT now(),
    CONSTRAINT task_subtasks_title_len CHECK (char_length(title) BETWEEN 1 AND 200)
);

CREATE INDEX task_subtasks_task_idx ON task_subtasks (task_id, position);
