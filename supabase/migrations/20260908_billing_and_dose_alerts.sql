-- 2026-09-08: card-on-file trial and notifications instead of texts.
--
-- 1. notification_log accepts the new notification types.
-- 2. dose_alerts records the once-per-dose "may have missed a dose" family
--    notification sent by the medication-reminders cron.
-- Nothing here touches user_profile; the trial itself is driven by the
-- existing subscription_tier / trial_status / subscription_period_end
-- columns and the billing platforms' webhooks.

alter table public.notification_log drop constraint if exists notification_log_notification_type_check;
alter table public.notification_log add constraint notification_log_notification_type_check
  check (notification_type = any (array[
    'check_in', 'missed_check_in', 'help_request', 'family_message', 'medication_reminder',
    'trial_reminder', 'system', 'invite', 'invite_reminder',
    'trial_ending', 'payment_failed', 'plan_ended', 'missed_dose', 'nudge'
  ]));

create table if not exists public.dose_alerts (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications(id) on delete cascade,
  family_root uuid not null,
  date text not null,
  scheduled_time text not null,
  notified integer not null default 0,
  delivered integer not null default 0,
  created_at timestamptz not null default now(),
  unique (medication_id, date, scheduled_time)
);

alter table public.dose_alerts enable row level security;
-- No policies on purpose: only the service role (the cron) reads or writes.
revoke all on public.dose_alerts from anon, authenticated;
