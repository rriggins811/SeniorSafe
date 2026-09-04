-- 2026-09-04: let notification_log record invite texts. The send-invite and
-- invite-reminders functions insert notification_type 'invite' and
-- 'invite_reminder'; the CHECK constraint rejected them, so their inserts
-- failed silently and the per-person daily invite limit could not count.
-- Rollback: recreate the constraint without the two new values.
ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_notification_type_check;
ALTER TABLE public.notification_log ADD CONSTRAINT notification_log_notification_type_check
  CHECK (notification_type = ANY (ARRAY['check_in','missed_check_in','help_request','family_message','medication_reminder','trial_reminder','system','invite','invite_reminder']));
