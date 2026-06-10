-- 2026-06-10: Database-level safety net against deleting a user_profile that holds
-- paid access (Door #2 of the Debra fix).
--
-- WHY: today's app-layer guard only taught the delete-account edge function to
-- preserve paid rows. But user_profile_user_id_fkey is ON DELETE CASCADE, so
-- deleting the auth.users row by ANY other path (manual Supabase dashboard
-- delete, admin API, a stray cascade) still silently destroys the profile
-- including paid Blueprint course_access. This is the exact mechanism that wiped
-- Debra's purchase.
--
-- WHAT: a BEFORE DELETE trigger on user_profile that refuses to delete a row
-- holding paid course access OR a paid subscription, UNLESS the caller has
-- explicitly set app.allow_paid_delete='on' in the same transaction (a
-- deliberate operator action). On that deliberate path the row is first
-- snapshotted to backups.user_profile_deleted so it is always recoverable.
--
-- SAFE FOR EXISTING FLOWS: free accounts delete normally; the delete-account
-- edge function preserves paid rows (never deletes them) and hard-deletes only
-- free rows, so it is unaffected. Verified live after apply: deleting a paid row
-- with no override is BLOCKED; with the override it is ALLOWED and writes one
-- backups.user_profile_deleted snapshot.

CREATE TABLE IF NOT EXISTS backups.user_profile_deleted (
  backup_id  bigint generated always as identity primary key,
  user_id    uuid,
  row_data   jsonb       not null,
  deleted_at timestamptz not null default now()
);

CREATE OR REPLACE FUNCTION public.guard_paid_profile_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  paid_course boolean := (OLD.course_access ->> 'tier') IN ('core','premium');
  paid_sub    boolean := OLD.subscription_tier IS NOT NULL AND OLD.subscription_tier NOT IN ('free');
BEGIN
  IF paid_course OR paid_sub THEN
    -- Deliberate deletion path: operator sets app.allow_paid_delete=on in the
    -- same transaction. Snapshot the row first so it is always recoverable.
    IF current_setting('app.allow_paid_delete', true) = 'on' THEN
      INSERT INTO backups.user_profile_deleted (user_id, row_data)
        VALUES (OLD.user_id, to_jsonb(OLD));
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Refusing to delete user_profile for % : it holds paid access (course_access.tier=%, subscription_tier=%). Debra safeguard. To intentionally delete, run "SET LOCAL app.allow_paid_delete = ''on'';" in the same transaction (the row is snapshotted to backups.user_profile_deleted first).',
      OLD.user_id, (OLD.course_access ->> 'tier'), OLD.subscription_tier;
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS guard_paid_profile_delete ON public.user_profile;
CREATE TRIGGER guard_paid_profile_delete
  BEFORE DELETE ON public.user_profile
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_profile_delete();
