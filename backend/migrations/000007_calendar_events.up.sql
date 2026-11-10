-- Important days on the calendar, and the reminders they send.
--
-- An important day belongs either to one person (owner_id) or to a project (project_id), never both:
-- a project's day is seen by every member of the project. remind_days says how many days before the day
-- to remind (0 = on the day itself); only 0, 1, 3 and 7 are offered.

CREATE TABLE events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title       text        NOT NULL,
    note        text        NOT NULL DEFAULT '',
    day         date        NOT NULL,
    project_id  uuid REFERENCES projects (id) ON DELETE CASCADE,
    owner_id    uuid REFERENCES users (id) ON DELETE CASCADE,
    created_by  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    remind_days int[]       NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT events_title_len CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT events_note_len CHECK (char_length(note) <= 1000),
    CONSTRAINT events_belongs_to_one CHECK ((project_id IS NULL) <> (owner_id IS NULL)),
    CONSTRAINT events_remind_days_valid CHECK (remind_days <@ ARRAY[0, 1, 3, 7])
);

CREATE INDEX events_project_day_idx ON events (project_id, day) WHERE project_id IS NOT NULL;
CREATE INDEX events_owner_day_idx ON events (owner_id, day) WHERE owner_id IS NOT NULL;

-- One reminder, for one person, about one important day, for one of its reminder days. The unique key
-- makes the reminder job safe to run again and again: each reminder is made once.
CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event_id    uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    days_before int         NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    read_at     timestamptz,
    CONSTRAINT notifications_once UNIQUE (user_id, event_id, days_before)
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
