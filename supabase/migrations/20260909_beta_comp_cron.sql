-- 2026-09-09: beta tester comp. Owners who sign up with "+test" or "+beta" in
-- the email get the paid plan for 30 days (subscription_platform 'beta'), and
-- fall back to free when that period ends. Runs every five minutes.
-- To undo: select cron.unschedule('beta-comp-test-signups');
select cron.schedule('beta-comp-test-signups', '*/5 * * * *', $job$
  set app.family_admin = 'on';
  -- 1. Switch new +test / +beta owners on (paid, 30 days).
  update public.user_profile p
     set subscription_tier = 'paid',
         subscription_platform = 'beta',
         subscription_period_end = now() + interval '30 days',
         trial_status = 'none'
    from auth.users u
   where u.id = p.user_id
     and p.role = 'admin'
     and p.invited_by is null
     and p.subscription_tier = 'free'
     and p.subscription_platform is distinct from 'beta'
     and (u.email ilike '%+test@%' or u.email ilike '%+beta@%')
     and p.created_at > now() - interval '14 days';
  -- 2. Switch expired beta comps back to free (only rows this job created).
  update public.user_profile p
     set subscription_tier = 'free'
   where p.subscription_platform = 'beta'
     and p.subscription_tier = 'paid'
     and p.subscription_period_end < now()
     and p.stripe_subscription_id is null
     and p.apple_original_transaction_id is null
     and p.google_original_transaction_id is null;
$job$);
