-- 2026-09-09: the two frequent crons call edge functions that take longer than
-- pg_net's 5 s default while they walk every family. The request timed out on
-- the caller side (net._http_response shows "Timeout of 5000 ms reached"), which
-- hid real failures behind "job succeeded". Give them 55 s.
-- Applied to production 2026-09-09 10:10 AM via cron.alter_job.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'missed-checkin-alerts'),
  command := $c$
  select net.http_post(
    url := 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/missed-checkin-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
$c$);
select cron.alter_job(
  (select jobid from cron.job where jobname = 'medication-reminders'),
  command := $c$
  select net.http_post(
    url := 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/medication-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
$c$);
