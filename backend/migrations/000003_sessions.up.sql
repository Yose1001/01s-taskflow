-- Sign-in sessions, so a person stays signed in after reloading the page.
-- One row per signed-in browser. The browser keeps a random refresh token in an httpOnly cookie;
-- only its SHA-256 hash is stored here, so a copy of this table cannot be used to sign in.
-- Every use of the token replaces it with a new one (rotation). The previous hash stays usable for a
-- few seconds (previous_valid_until) because two tabs opened at once both send the old token.
CREATE TABLE sessions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash           bytea       NOT NULL,
    previous_hash        bytea,
    previous_valid_until timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    last_used_at         timestamptz NOT NULL DEFAULT now(),
    expires_at           timestamptz NOT NULL,
    CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT sessions_previous_pair CHECK ((previous_hash IS NULL) = (previous_valid_until IS NULL))
);

CREATE INDEX sessions_previous_hash_idx ON sessions (previous_hash) WHERE previous_hash IS NOT NULL;
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
