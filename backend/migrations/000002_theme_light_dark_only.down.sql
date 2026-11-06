-- Restores the old rule. Accounts already converted from "system" to "light" stay "light" (that is not reversible).
ALTER TABLE users DROP CONSTRAINT users_theme_valid;
ALTER TABLE users ADD CONSTRAINT users_theme_valid CHECK (theme IN ('light', 'dark', 'system'));
ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'system';
