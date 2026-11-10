-- A personal important day can be shared with chosen people: they see it on their calendar and are
-- reminded, but only its owner changes it. Only personal days are shared (a project's day is already
-- seen by every member); the service checks that, and that each person shares a project with the owner.

CREATE TABLE event_shares (
    event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX event_shares_user_idx ON event_shares (user_id);
