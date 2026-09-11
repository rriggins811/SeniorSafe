-- 2026-09-11: account deletion for paid, trial and comped families.
--
-- guard_paid_profile_delete (the Debra safeguard) refuses to delete any
-- user_profile whose subscription_tier is not 'free' unless the same
-- transaction sets app.allow_paid_delete = 'on'. The delete-account edge
-- function never set it, so a paying family that tapped "Delete My Account"
-- got "success" while nothing was deleted (found in the 2026-09-11 web sweep:
-- "Auth deletion error: Database error deleting user" in the function logs,
-- the auth user and profile still in place).
--
-- This function is the one deliberate deletion path the edge function calls
-- with the service role. The trigger still snapshots the row into
-- backups.user_profile_deleted before it goes, so nothing is lost.

create or replace function public.delete_profile_for_account_deletion(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;
  perform set_config('app.allow_paid_delete', 'on', true);
  delete from public.user_profile where user_id = p_user;
end;
$$;

revoke all on function public.delete_profile_for_account_deletion(uuid) from public;
revoke all on function public.delete_profile_for_account_deletion(uuid) from anon;
revoke all on function public.delete_profile_for_account_deletion(uuid) from authenticated;
grant execute on function public.delete_profile_for_account_deletion(uuid) to service_role;
