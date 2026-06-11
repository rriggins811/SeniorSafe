-- 2026-06-11 (security audit #3): clamp entitlement columns on CLIENT inserts of
-- user_profile. Profiles are created client-side and protect_user_profile_columns
-- only guards UPDATE, so a crafted sign-up could self-grant subscription_tier=
-- 'premium_plus' (free paid app tier) or course_access (free paid Blueprint course).
-- This BEFORE INSERT trigger rewrites those to safe values ONLY when a paid value is
-- set, so the normal sign-up defaults (subscription_tier='trial', course_access='{}')
-- are untouched (non-breaking; course_access is NOT NULL). Service-role paths
-- (Stripe webhook, free-tier onboarding, IAP) bypass. Verified live: an authenticated
-- insert of premium_plus + paid course -> clamped to trial / {}, a normal trial
-- insert -> unchanged.
CREATE OR REPLACE FUNCTION public.clamp_profile_insert_entitlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role'
     OR current_setting('role', true) IN ('service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.subscription_tier IN ('paid', 'premium_plus') THEN
    NEW.subscription_tier := 'trial';
  END IF;
  IF COALESCE(NEW.course_access ->> 'tier', '') IN ('core', 'premium', 'paid') THEN
    NEW.course_access := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS clamp_profile_insert_entitlement ON public.user_profile;
CREATE TRIGGER clamp_profile_insert_entitlement
  BEFORE INSERT ON public.user_profile
  FOR EACH ROW EXECUTE FUNCTION public.clamp_profile_insert_entitlement();
