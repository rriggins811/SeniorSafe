-- 2026-09-04 setup rebuild, step 2: the invite actually arrives.
--
-- Adds the two columns the send-invite and invite-reminders edge functions
-- use, and schedules the daily reminder cron. No new SQL functions, so no
-- REVOKE needed. Deploy the two edge functions (send-invite, invite-reminders)
-- from their on-disk source before running this, otherwise the cron 404s
-- harmlessly until they exist.
--
-- Rollback: SELECT cron.unschedule('invite-reminders');
--           ALTER TABLE public.user_profile DROP COLUMN invite_sent_at, DROP COLUMN invite_reminders_sent;

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS invite_reminders_sent integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.user_profile.invite_sent_at IS
  'Owner rows: when the senior invite text was last sent (by the app or the reminder cron).';
COMMENT ON COLUMN public.user_profile.invite_reminders_sent IS
  'Owner rows: how many automatic reminder texts have gone to the senior. Stops at 2.';

-- Daily at 15:00 UTC (11 AM Eastern). Same vault pattern as trial-downgrade-daily.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invite-reminders') THEN
    PERFORM cron.unschedule('invite-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'invite-reminders',
  '0 15 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/invite-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);
