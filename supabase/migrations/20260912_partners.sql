-- 2026-09-12: partner co-branding, Level 1 ("Shared by").
--
-- A partner is a row in public.partners, never a new app. A family that signs
-- up through a partner's link (hammock365.com/p/<code> sends them to
-- app.hammock365.com/signup?partner=<code>) or types the code at signup
-- carries partner_code on the OWNER's profile. Siblings and the senior see the
-- owner's partner. The app shows "Shared by <name>" only when a valid, active
-- code exists on the family. No code, no change.
--
-- Clients never read public.partners directly. lookup_partner() is the door
-- (active rows, public columns only). set_partner_code() is the one client
-- write: the owner, inside 30 days of signup, once. Rows are added with the
-- service role. partner_stats is the scoreboard, service role only.
--
-- To undo: drop view public.partner_stats; drop function public.set_partner_code(text),
-- public.lookup_partner(text), public.validate_partner_code_on_insert();
-- alter table public.user_profile drop column partner_code; drop table public.partners;
-- delete from storage.buckets where id = 'partner-logos'; and put back
-- protect_user_profile_columns without the partner_code block at the top.

-- 1. The partners table ---------------------------------------------------

create table if not exists public.partners (
  code            text primary key
                  check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name            text not null,
  logo_url        text,
  phone           text,
  tagline         text check (tagline is null or char_length(tagline) <= 80),
  partner_type    text not null default 'other'
                  check (partner_type in ('home_care', 'medicare', 'senior_living', 'assisted_living', 'elder_law', 'other')),
  is_demo         boolean not null default false,
  active          boolean not null default true,
  ghl_contact_id  text,
  created_at      timestamptz not null default now()
);

comment on table public.partners is
  'Partner co-branding, Level 1. One row per partner who shares Hammock365 with the families they serve. Read by clients only through lookup_partner().';
comment on column public.partners.is_demo is
  'The "Your Business Name Here" row Ryan shows prospects. Excluded from every count.';

alter table public.partners enable row level security;
-- Default privileges hand anon and authenticated full access to new tables.
-- Nobody but the service role touches this table directly.
revoke all on public.partners from anon, authenticated;

-- Logos live in a public bucket. Uploads are service role only.
insert into storage.buckets (id, name, public)
values ('partner-logos', 'partner-logos', true)
on conflict (id) do nothing;

-- 2. The family's partner --------------------------------------------------

alter table public.user_profile
  add column if not exists partner_code text references public.partners(code) on delete set null;

comment on column public.user_profile.partner_code is
  'Owners only. The partner whose link or code brought this family in. Members inherit it through the owner (lib/family.js).';

create index if not exists user_profile_partner_code_idx
  on public.user_profile (partner_code) where partner_code is not null;

-- A new profile may carry a code only if it is real, active, and the row is
-- the family owner. Anything else is dropped silently so signup never fails
-- over a typo. security definer because the client role cannot read partners.
create or replace function public.validate_partner_code_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.partner_code is not null then
    new.partner_code := lower(trim(new.partner_code));
    if new.role is distinct from 'admin'
       or not exists (select 1 from public.partners p where p.code = new.partner_code and p.active) then
      new.partner_code := null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.validate_partner_code_on_insert() from public, anon, authenticated;

drop trigger if exists validate_partner_code_on_insert on public.user_profile;
create trigger validate_partner_code_on_insert
  before insert on public.user_profile
  for each row execute function public.validate_partner_code_on_insert();

-- After insert the client may not change partner_code directly; the one
-- client path is set_partner_code() below, which sets app.partner_code_write.
-- Hand edits in the SQL editor use the existing operator override:
--   set app.family_admin = 'on';
-- Body below is the live definition (with the app.family_admin bypass the
-- beta-comp cron uses) plus the partner_code block at the top.
create or replace function public.protect_user_profile_columns()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.partner_code is distinct from old.partner_code then
    if auth.role() = 'service_role'
       or current_setting('role', true) in ('service_role', 'supabase_admin')
       or current_setting('app.partner_code_write', true) = 'on'
       or current_setting('app.family_admin', true) = 'on' then
      null;
    else
      raise exception 'partner_code is set through set_partner_code()';
    end if;
  end if;
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
    if current_setting('app.family_admin', true) = 'on' then return new; end if;
    raise exception 'You cannot modify protected columns (role, subscription_tier, course_access, message_count, message_limit, message_week_start, family_code, invited_by, is_senior)';
  end if;
  return new;
end;
$function$;

-- 3. The door: what a client may read about a partner ------------------------

create or replace function public.lookup_partner(p_code text)
returns table (code text, name text, logo_url text, phone text, tagline text, partner_type text)
language sql
stable
security definer
set search_path = public
as $$
  select p.code, p.name, p.logo_url, p.phone, p.tagline, p.partner_type
    from public.partners p
   where p.code = lower(trim(p_code))
     and p.active
$$;

revoke all on function public.lookup_partner(text) from public;
grant execute on function public.lookup_partner(text) to anon, authenticated, service_role;

-- 4. The one client write: add a code in Settings inside 30 days ------------
-- The store-install gap: a family that installed from the App Store or Play
-- never carried the link. They type the code from the partner's flyer.

create or replace function public.set_partner_code(p_code text)
returns table (code text, name text, logo_url text, phone text, tagline text, partner_type text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := lower(trim(p_code));
  v_row  public.user_profile%rowtype;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  select * into v_row from public.user_profile where user_id = v_uid;
  if not found or v_row.role is distinct from 'admin' then
    raise exception 'Only the person who set up the family can add a partner code.';
  end if;
  if v_row.partner_code is not null then
    raise exception 'This family already has a partner code.';
  end if;
  if v_row.created_at < now() - interval '30 days' then
    raise exception 'A partner code can be added only in the first 30 days.';
  end if;
  if not exists (select 1 from public.partners p where p.code = v_code and p.active) then
    raise exception 'We could not find that code.';
  end if;
  perform set_config('app.partner_code_write', 'on', true);
  update public.user_profile set partner_code = v_code where user_id = v_uid;
  return query
    select p.code, p.name, p.logo_url, p.phone, p.tagline, p.partner_type
      from public.partners p
     where p.code = v_code;
end;
$$;

revoke all on function public.set_partner_code(text) from public, anon;
grant execute on function public.set_partner_code(text) to authenticated, service_role;

-- 5. The scoreboard ---------------------------------------------------------
-- One row per real partner. Demo partners and test accounts never count.
-- Runs as the view owner, so it must stay service role only (revoked below).

create or replace view public.partner_stats as
with owners as (
  select o.user_id, o.partner_code, o.onboarding_complete, o.subscription_tier,
         exists (
           select 1
             from public.checkins c
             join public.user_profile s on s.user_id = c.user_id
            where coalesce(s.invited_by, s.user_id) = o.user_id
              and c.checked_in_at >= now() - interval '7 days'
         ) as active_7d
    from public.user_profile o
   where o.role = 'admin'
     and o.partner_code is not null
     and coalesce(o.is_test, false) = false
)
select p.code,
       p.name,
       p.partner_type,
       p.active,
       count(w.user_id)                                                          as households,
       count(w.user_id) filter (where w.onboarding_complete)                     as setup_complete,
       count(w.user_id) filter (where w.active_7d)                               as active_7d,
       count(w.user_id) filter (where w.subscription_tier in ('paid', 'premium_plus')) as paid
  from public.partners p
  left join owners w on w.partner_code = p.code
 where not p.is_demo
 group by p.code, p.name, p.partner_type, p.active;

revoke all on public.partner_stats from anon, authenticated;

-- 6. Day one: the demo partner Ryan shows prospects, and RSS itself ---------

insert into public.partners (code, name, logo_url, phone, tagline, partner_type, is_demo, active) values
  ('demo', 'Your Business Name Here',
   'https://hammock365.com/partners/demo-logo.svg',
   '3365538933', 'Your one line goes here.', 'home_care', true, true),
  ('rss',  'Riggins Strategic Solutions',
   'https://rigginsstrategicsolutions.com/logo/riggins_logo_horizontal.png',
   '3365538933', 'Help for families through the senior transition.', 'other', false, true)
on conflict (code) do nothing;
