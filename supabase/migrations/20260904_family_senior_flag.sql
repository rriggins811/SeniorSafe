-- 2026-09-04 setup rebuild, step 1.
--
-- The adult child now sets up SeniorSafe first, on their own phone, and the
-- senior joins by a link. That splits two things the schema used to treat as
-- one: the family OWNER (role='admin', holds family_code + subscription) and
-- the person who CHECKS IN. This migration adds an explicit is_senior flag,
-- backfills it so every existing family keeps working exactly as before
-- (owners were the seniors), and widens two reads that the new adult-child
-- screens need.
--
-- Rollback: drop index user_profile_one_senior_per_family; drop column
-- is_senior; drop column senior_phone; restore the previous policy /
-- function bodies from 20260611_rate_limit_lookup_invite_code.sql and the
-- protect_user_profile_columns definition in prod (unchanged except for the
-- one added line).

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS is_senior boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS senior_phone text;

COMMENT ON COLUMN public.user_profile.is_senior IS
  'True for the one person in the family who taps "I''m Okay". Owner (admin) if they set up for themselves; a member row if an adult child invited them.';
COMMENT ON COLUMN public.user_profile.senior_phone IS
  'Adult-child owners only: the senior''s mobile number, captured at setup so the invite can be texted before the senior has an account.';

-- Legacy families: the owner was always the person checking in.
UPDATE public.user_profile
   SET is_senior = true
 WHERE role = 'admin' AND is_senior = false;

-- Exactly one senior per family. Family key = COALESCE(invited_by, user_id),
-- the same expression is_family_member() uses.
CREATE UNIQUE INDEX IF NOT EXISTS user_profile_one_senior_per_family
  ON public.user_profile ((COALESCE(invited_by, user_id)))
  WHERE is_senior;

-- Every family member can read every profile in their family. Before this a
-- member could read only themselves and the owner, so a sibling could never
-- see the senior's row once the senior is a member instead of the owner.
DROP POLICY IF EXISTS "family members can read family profiles" ON public.user_profile;
CREATE POLICY "family members can read family profiles"
  ON public.user_profile FOR SELECT
  USING ((SELECT auth.uid()) = user_id OR public.is_family_member(user_id));

-- is_senior is set once at insert and may not be flipped from the client.
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
  OR NEW.is_senior          IS DISTINCT FROM OLD.is_senior
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
    RAISE EXCEPTION 'You cannot modify protected columns (role, subscription_tier, course_access, message_count, message_limit, message_week_start, family_code, invited_by, is_senior)';
  END IF;
  RETURN NEW;
END;
$function$;

-- The invite screens need to greet the senior by name and know whether the
-- senior has already joined. Rate limiting is unchanged. Return type changes,
-- so the function is dropped and recreated; grants are re-applied explicitly
-- (new functions default to PUBLIC execute).
DROP FUNCTION IF EXISTS public.lookup_invite_code(text);
CREATE FUNCTION public.lookup_invite_code(invite_code text)
 RETURNS TABLE(user_id uuid, family_name text, owner_first_name text, senior_name text, has_senior boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text;
  v_attempts int;
  v_limit constant int := 30;  -- per IP per hour
BEGIN
  v_ip := coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)
  );
  v_ip := nullif(trim(coalesce(v_ip, '')), '');

  IF v_ip IS NOT NULL THEN
    INSERT INTO public.invite_code_lookup_log AS l (ip, window_start, attempts)
    VALUES (v_ip, now(), 1)
    ON CONFLICT (ip) DO UPDATE SET
      attempts     = CASE WHEN l.window_start < now() - interval '1 hour' THEN 1 ELSE l.attempts + 1 END,
      window_start = CASE WHEN l.window_start < now() - interval '1 hour' THEN now() ELSE l.window_start END
    RETURNING l.attempts INTO v_attempts;

    IF v_attempts > v_limit THEN
      RAISE EXCEPTION 'Too many invite-code lookups from your network. Please wait and try again.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN QUERY
  SELECT up.user_id,
         up.family_name,
         up.first_name,
         COALESCE(
           (SELECT s.first_name FROM public.user_profile s
             WHERE s.is_senior AND COALESCE(s.invited_by, s.user_id) = up.user_id LIMIT 1),
           up.senior_name),
         EXISTS (SELECT 1 FROM public.user_profile s
                  WHERE s.is_senior AND COALESCE(s.invited_by, s.user_id) = up.user_id)
  FROM public.user_profile up
  WHERE up.family_code = upper(trim(invite_code))
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_invite_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_invite_code(text) TO anon, authenticated;
