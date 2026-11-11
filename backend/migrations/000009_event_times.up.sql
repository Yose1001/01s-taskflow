-- An important day can have a time of day (Thai time), and reminders a few minutes or hours before it.
-- A day without a time still reminds at the morning hour, some days before.
ALTER TABLE events
    ADD COLUMN at_time time,
    ADD COLUMN remind_minutes int[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT events_remind_minutes_valid CHECK (remind_minutes <@ ARRAY[15, 30, 60, 120]),
    ADD CONSTRAINT events_remind_minutes_need_time CHECK (cardinality(remind_minutes) = 0 OR at_time IS NOT NULL);

-- A reminder is either for some days before (minutes_before = 0) or for some minutes before the time.
-- Each one is still made once: the unique key now tells "on the day" and "15 minutes before" apart.
ALTER TABLE notifications
    ADD COLUMN minutes_before int NOT NULL DEFAULT 0,
    ADD CONSTRAINT notifications_minutes_valid CHECK (minutes_before IN (0, 15, 30, 60, 120)),
    DROP CONSTRAINT notifications_once,
    ADD CONSTRAINT notifications_once UNIQUE (user_id, event_id, days_before, minutes_before);
