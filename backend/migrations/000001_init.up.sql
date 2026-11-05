-- TaskFlow initial schema (see docs/02-er-diagram.md). Requires PostgreSQL 15+.

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    password_hash text        NOT NULL,
    display_name  text        NOT NULL,
    locale        text        NOT NULL DEFAULT 'en',
    theme         text        NOT NULL DEFAULT 'system',
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 80),
    CONSTRAINT users_locale_valid CHECK (locale IN ('th', 'en')),
    CONSTRAINT users_theme_valid CHECK (theme IN ('light', 'dark', 'system'))
);

CREATE TABLE projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    description text        NOT NULL DEFAULT '',
    owner_id    uuid        NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    deleted_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT projects_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT projects_description_len CHECK (char_length(description) <= 2000),
    CONSTRAINT projects_deleted_by_needs_deleted_at CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL)
);

CREATE TABLE project_members (
    project_id uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text        NOT NULL,
    joined_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id),
    CONSTRAINT project_members_role_valid CHECK (role IN ('owner', 'member'))
);

-- Exactly one owner per project.
CREATE UNIQUE INDEX project_members_one_owner ON project_members (project_id) WHERE role = 'owner';
CREATE INDEX project_members_user_idx ON project_members (user_id);

CREATE TABLE tasks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid             NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    title       text             NOT NULL,
    description text             NOT NULL DEFAULT '',
    status      text             NOT NULL DEFAULT 'todo',
    priority    text             NOT NULL DEFAULT 'medium',
    assignee_id uuid,
    created_by  uuid             NOT NULL REFERENCES users (id),
    due_date    date,
    position    double precision NOT NULL,
    created_at  timestamptz      NOT NULL DEFAULT now(),
    updated_at  timestamptz      NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    deleted_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT tasks_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
    CONSTRAINT tasks_description_len CHECK (char_length(description) <= 5000),
    CONSTRAINT tasks_status_valid CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
    CONSTRAINT tasks_priority_valid CHECK (priority IN ('low', 'medium', 'high')),
    CONSTRAINT tasks_deleted_by_needs_deleted_at CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL),
    -- Assignee must be a member of the same project. Removing the member clears only assignee_id.
    CONSTRAINT tasks_assignee_is_member FOREIGN KEY (project_id, assignee_id)
        REFERENCES project_members (project_id, user_id) ON DELETE SET NULL (assignee_id)
);

-- Board listing (active tasks only).
CREATE INDEX tasks_board_idx ON tasks (project_id, status, position) WHERE deleted_at IS NULL;
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id) WHERE deleted_at IS NULL;
-- Trash listing and the purge job.
CREATE INDEX tasks_trash_idx ON tasks (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX projects_trash_idx ON projects (deleted_at) WHERE deleted_at IS NOT NULL;
