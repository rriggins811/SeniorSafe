-- 2026-09-08 sweep. Applied to production the same day via the SQL API; this file matches.

-- 1. The emergency card and the senior's call contacts are family-wide reads.
--    (Writes stay per user; the newest card written by anyone in the family is the card.)
create policy "family emergency select" on public.emergency_info
  for select using ((select auth.uid()) = user_id or is_family_member(user_id));
create policy "family emergency update" on public.emergency_info
  for update using ((select auth.uid()) = user_id or is_family_member(user_id))
  with check ((select auth.uid()) = user_id or is_family_member(user_id));
create policy "family contacts select" on public.quick_dial_contacts
  for select using ((select auth.uid()) = user_id or is_family_member(user_id));

-- 2. The protected-columns trigger blocked two owner actions the app relies on:
--    minting a missing family_code and unlinking a member. Both now run inside
--    SECURITY DEFINER functions that set a transaction-local flag the trigger honors.
create or replace function public.protect_user_profile_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.role               is distinct from old.role
  or new.subscription_tier  is distinct from old.subscription_tier
  or new.course_access      is distinct from old.course_access
  or new.message_count      is distinct from old.message_count
  or new.message_limit      is distinct from old.message_limit
  or new.message_week_start is distinct from old.message_week_start
  or new.family_code        is distinct from old.family_code
  or new.invited_by         is distinct from old.invited_by
  or new.is_senior          is distinct from old.is_senior
  then
    if auth.role() = 'service_role' then return new; end if;
    if current_setting('role', true) in ('service_role', 'supabase_admin') then return new; end if;
    -- Set only by mint_family_code() and remove_family_member() below, for the current transaction.
    if current_setting('app.family_admin', true) = 'on' then return new; end if;
    raise exception 'You cannot modify protected columns (role, subscription_tier, course_access, message_count, message_limit, message_week_start, family_code, invited_by, is_senior)';
  end if;
  return new;
end;
$function$;

create or replace function public.new_family_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.user_profile where family_code = code);
  end loop;
  return code;
end;
$$;

-- The owner mints their own missing code (older accounts predate the column).
create or replace function public.mint_family_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  existing text;
  code text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select family_code into existing from public.user_profile where user_id = me and invited_by is null;
  if not found then raise exception 'only a family owner has a code'; end if;
  if existing is not null then return existing; end if;
  code := public.new_family_code();
  perform set_config('app.family_admin', 'on', true);
  update public.user_profile set family_code = code where user_id = me;
  return code;
end;
$$;

-- The owner unlinks a member; the member becomes the owner of an empty family with their own code.
create or replace function public.remove_family_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.user_profile where user_id = p_member and invited_by = me) then
    raise exception 'that person is not a member of your family';
  end if;
  if exists (select 1 from public.user_profile where user_id = p_member and is_senior = true) then
    raise exception 'the senior cannot be removed; delete the family instead';
  end if;
  perform set_config('app.family_admin', 'on', true);
  update public.user_profile
    set invited_by = null, role = 'admin', family_code = coalesce(family_code, public.new_family_code())
    where user_id = p_member;
end;
$$;

revoke all on function public.mint_family_code() from public, anon;
revoke all on function public.remove_family_member(uuid) from public, anon;
revoke all on function public.new_family_code() from public, anon, authenticated;
grant execute on function public.mint_family_code() to authenticated;
grant execute on function public.remove_family_member(uuid) to authenticated;

-- 3. The two dashboard-created crons called their functions with the anon key and a
--    personal access token. They now send the service role key from the vault, like the
--    migration-defined jobs, and the functions require it.
select cron.alter_job((select jobid from cron.job where jobname = 'medication-reminders'), command := $cmd$
  select net.http_post(
    url := 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/medication-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
$cmd$);
select cron.alter_job((select jobid from cron.job where jobname = 'missed-checkin-alerts'), command := $cmd$
  select net.http_post(
    url := 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/missed-checkin-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
$cmd$);
