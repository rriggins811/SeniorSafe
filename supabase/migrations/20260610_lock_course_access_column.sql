-- 2026-06-10: Lock course_access (paid Blueprint access) against non-service writes.
--
-- WHY: blueprint-site and the SeniorSafe app share ONE user_profile row per
-- person. The protect_user_profile_columns trigger already guarded role /
-- subscription_tier / family_code / invited_by etc. against non-service writes,
-- but it did NOT cover course_access — the column that holds paid Blueprint
-- course access. So any authenticated "save profile" in either app that
-- round-tripped a stale/empty value could silently clobber a paid course
-- (the Debra-class failure, via UPDATE instead of DELETE).
--
-- SAFETY: the only two writers of course_access are the blueprint Stripe webhook
-- and free-tier onboarding (onboard-free-user.ts), both using the service_role
-- admin client, which passes the existing carve-out unchanged. No client/app
-- path writes course_access (verified by grep across both repos). Verified live
-- after apply: an authenticated change to course_access is blocked; an
-- authenticated update leaving course_access unchanged passes; subscription_tier
-- protection still works.
--
-- DRIFT NOTE: protect_user_profile_columns() had been applied directly to the
-- database and was never committed to a migration. This migration captures its
-- canonical definition (now including course_access) so repo == prod going forward.

CREATE OR REPLACE FUNCTION public.protect_user_profile_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role               IS DISTINCT FROM OLD.role
  OR NEW.subscription_tier  IS DISTINCT FROM OLD.subscription_tier
  OR NEW.course_access      IS DISTINCT FROM OLD.course_access
  OR NEW.message_count      IS DISTINCT FROM OLD.message_count
  OR NEW.message_limit      IS DISTINCT FROM OLD.message_limit
  OR NEW.message_week_start IS DISTINCT FROM OLD.message_week_start
  OR NEW.family_code        IS DISTINCT FROM OLD.family_code
  OR NEW.invited_by         IS DISTINCT FROM OLD.invited_by
  THEN
    -- Allow service_role (edge functions / server-side admin clients). The
    -- Stripe webhook and free-tier onboarding write course_access this way.
    IF auth.role() = 'service_role' THEN
      RETURN NEW;
    END IF;
    -- Also allow if the PostgreSQL role itself is service_role / supabase_admin.
    IF current_setting('role', true) IN ('service_role', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'You cannot modify protected columns (role, subscription_tier, course_access, message_count, message_limit, message_week_start, family_code, invited_by)';
  END IF;
  RETURN NEW;
END;
$function$;
