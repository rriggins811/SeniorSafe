-- Partner requests: the "Get your code" form. Partner co-branding, Level 1
-- ("Shared by"), Ryan's GO 2026-09-12 (the mailto button led nowhere).
--
-- A partner applies at hammock365.com/partners/apply. The edge function
-- partner-apply writes the row here with active = false, which keeps it
-- invisible to families (lookup_partner and the app both filter on active),
-- uploads the logo, tags the GHL contact hammock-partner-request and emails
-- support@hammock365.com a single-use review link. partner-review flips
-- active on approval and sends the kit email (link, QR, flyer). Nothing is
-- typed by us; the only manual step is Ryan's approve or decline.

alter table public.partners
  add column if not exists contact_name       text,
  add column if not exists contact_email      text,
  add column if not exists requested_at       timestamptz,
  add column if not exists approved_at        timestamptz,
  add column if not exists terms_version      text,
  add column if not exists terms_accepted_at  timestamptz,
  add column if not exists review_token       text,
  add column if not exists source             text not null default 'manual'
                                              check (source in ('manual', 'form'));

create unique index if not exists partners_review_token_idx
  on public.partners (review_token) where review_token is not null;

-- The two hand-made rows (demo, rss) count as approved when they were made.
update public.partners set approved_at = coalesce(approved_at, created_at) where active;

-- Partner types widened for the form: placement advisors, care managers and
-- churches were in the pitch but not in the constraint. The copy variants only
-- key on senior_living / assisted_living, so nothing else changes.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.partners'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%partner_type%';
  if c is not null then
    execute format('alter table public.partners drop constraint %I', c);
  end if;
end $$;

alter table public.partners add constraint partners_partner_type_check
  check (partner_type in ('home_care', 'medicare', 'senior_living', 'assisted_living',
                          'elder_law', 'placement', 'care_management', 'church', 'other'));

-- Live "is this code free?" check for the form. Unlike lookup_partner it sees
-- pending rows too, so two applicants cannot both be told a code is free.
-- Reserved words are the site's own paths and the brand.
create or replace function public.partner_code_available(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(p_code)) ~ '^[a-z0-9][a-z0-9-]{1,39}$'
     and lower(trim(p_code)) not in ('apply', 'terms', 'admin', 'support', 'hammock365',
                                     'hammock', 'test', 'partner', 'partners', 'demo')
     and not exists (select 1 from public.partners p where p.code = lower(trim(p_code)));
$$;

revoke all on function public.partner_code_available(text) from public;
grant execute on function public.partner_code_available(text) to anon, authenticated, service_role;
