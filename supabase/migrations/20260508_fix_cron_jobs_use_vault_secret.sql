-- Fix failing trial-downgrade-daily and ai-cleanup-daily cron jobs.
--
-- Both crons have been silently failing every day since launch with:
--   ERROR:  unrecognized configuration parameter "supabase.service_role_key"
--
-- Root cause: the original schedule called current_setting('supabase.service_role_key')
-- which only exists when set via ALTER DATABASE / ALTER SYSTEM. On Supabase managed
-- Postgres, that pattern returns the unrecognized-parameter error before the HTTP
-- request even fires.
--
-- Fix: store the service_role_key in Supabase Vault (one-time, done outside this
-- migration via SELECT vault.create_secret(...)) and reference it via
-- vault.decrypted_secrets at job-run time.
--
-- Before applying this migration, the Vault secret named 'service_role_key' must
-- exist. Verify with:
--   SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--
-- Impact of the failure: every trial-downgrade-daily run since launch was a no-op,
-- so trial users who hit day 14 stayed at premium_plus permanently — racking up
-- unbounded Maggie LLM cost. ai-cleanup-daily likewise never ran, so any data it
-- was supposed to age out was retained indefinitely.

-- Drop the broken schedules. Use IF EXISTS guards in case this is re-applied in a
-- branch / fresh project where the bad jobs were never scheduled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trial-downgrade-daily') THEN
    PERFORM cron.unschedule('trial-downgrade-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-cleanup-daily') THEN
    PERFORM cron.unschedule('ai-cleanup-daily');
  END IF;
END $$;

-- Re-schedule trial-downgrade-daily at 00:00 UTC daily.
SELECT cron.schedule(
  'trial-downgrade-daily',
  '0 0 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/trial-downgrade',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- Re-schedule ai-cleanup-daily at 08:00 UTC daily (preserves prior schedule slot).
SELECT cron.schedule(
  'ai-cleanup-daily',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/ai-cleanup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);
