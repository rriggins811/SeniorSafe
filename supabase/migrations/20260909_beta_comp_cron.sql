-- 2026-09-09: beta testers. Anyone who signs up as the family owner with
-- "+test" or "+beta" in their email gets the paid plan switched on within
-- five minutes, free, for 30 days (subscription_platform 'beta'). Ryan's
-- social posts ask testers to sign up that way. To end the program, unschedule
-- the job; to end one tester, set their tier back to 'free'.
-- Applied to production 2026-09-09 via cron.schedule.
select cron.schedule('beta-comp-test-signups', '*/5 * * * *', $job$
  set app.family_admin = 'on';
  update public.user_profile p
     set subscription_tier = 'paid',
         subscription_platform = 'beta',
         subscription_period_end = now() + interval '30 days',
         trial_status = 'none'
    from auth.users u
   where u.id = p.user_id
     and p.role = 'admin'
     and p.subscription_tier = 'free'
     and (u.email ilike '%+test@%' or u.email ilike '%+beta@%')
     and p.created_at > now() - interval '14 days';
$job$);
