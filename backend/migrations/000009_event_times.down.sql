ALTER TABLE notifications DROP CONSTRAINT notifications_once;
DELETE FROM notifications WHERE minutes_before > 0;
ALTER TABLE notifications
    DROP CONSTRAINT notifications_minutes_valid,
    DROP COLUMN minutes_before,
    ADD CONSTRAINT notifications_once UNIQUE (user_id, event_id, days_before);

ALTER TABLE events
    DROP CONSTRAINT events_remind_minutes_need_time,
    DROP CONSTRAINT events_remind_minutes_valid,
    DROP COLUMN remind_minutes,
    DROP COLUMN at_time;
