-- The app has two themes only: light and dark. "system" is removed.
-- Existing accounts that had "system" become "light" (the UI picks the device preference on first visit anyway).
UPDATE users SET theme = 'light' WHERE theme = 'system';

ALTER TABLE users DROP CONSTRAINT users_theme_valid;
ALTER TABLE users ADD CONSTRAINT users_theme_valid CHECK (theme IN ('light', 'dark'));
ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'light';
