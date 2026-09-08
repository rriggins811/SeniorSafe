-- Funnel dashboard for the 30-day push (HANDOFF step 4). One row per signup week.
-- households: owners (no invited_by, not test). parent_joined_48h: the senior
-- joined within 48 hours of the owner (self-setup counts). checked_in: any
-- check-in in the family. lock_taps: funnel_events lock_tap across the family.
-- paid: owner on paid/trial. Read it as service_role (SQL editor); anon and
-- authenticated cannot see it.
create or replace view public.funnel_dashboard as
with owners as (
  select p.user_id, p.created_at, p.is_senior, p.subscription_tier
  from public.user_profile p
  where p.invited_by is null and coalesce(p.is_test, false) = false
),
fam as (
  select coalesce(p.invited_by, p.user_id) as owner_id, p.user_id, p.is_senior, p.created_at
  from public.user_profile p
)
select
  date_trunc('week', o.created_at)::date as week_start,
  count(*)::int as households,
  count(*) filter (where o.is_senior or exists (
    select 1 from fam f
    where f.owner_id = o.user_id and f.is_senior and f.user_id <> o.user_id
      and f.created_at <= o.created_at + interval '48 hours'))::int as parent_joined_48h,
  count(*) filter (where exists (
    select 1 from public.checkins c join fam f on f.user_id = c.user_id
    where f.owner_id = o.user_id))::int as checked_in,
  coalesce(sum(lt.taps), 0)::int as lock_taps,
  count(*) filter (where o.subscription_tier in ('paid', 'trial', 'premium_plus'))::int as paid
from owners o
left join lateral (
  select count(*) as taps
  from public.funnel_events e join fam f on f.user_id = e.user_id
  where e.event = 'lock_tap' and f.owner_id = o.user_id
) lt on true
group by 1
order by 1 desc;

create or replace view public.funnel_totals as
select sum(households)::int as households, sum(parent_joined_48h)::int as parent_joined_48h,
       sum(checked_in)::int as checked_in, sum(lock_taps)::int as lock_taps, sum(paid)::int as paid
from public.funnel_dashboard;

revoke all on public.funnel_dashboard, public.funnel_totals from anon, authenticated;
