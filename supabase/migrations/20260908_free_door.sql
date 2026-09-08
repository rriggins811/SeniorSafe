-- 2026-09-08 (late morning): the free door.
-- 1. lookup_invite_code also returns the family's plan and how many family
--    contacts (non-senior accounts) it already has, so the join screen can
--    show the lock before someone creates an account. Rate limiting and
--    grants are unchanged from 20260904_family_senior_flag.sql.
-- 2. funnel_events records lock taps, plan-page views and checkout starts for
--    the launch dashboard. Users insert their own rows; only the service role reads.

DROP FUNCTION IF EXISTS public.lookup_invite_code(text);
CREATE FUNCTION public.lookup_invite_code(invite_code text)
 RETURNS TABLE(user_id uuid, family_name text, owner_first_name text, senior_name text, has_senior boolean, subscription_tier text, contact_count integer)
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
                  WHERE s.is_senior AND COALESCE(s.invited_by, s.user_id) = up.user_id),
         COALESCE(up.subscription_tier, 'free'),
         (SELECT count(*)::integer FROM public.user_profile c
           WHERE NOT c.is_senior AND COALESCE(c.invited_by, c.user_id) = up.user_id)
  FROM public.user_profile up
  WHERE up.family_code = upper(trim(invite_code))
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_invite_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_invite_code(text) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  feature text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funnel_events_created_idx ON public.funnel_events (created_at);
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funnel_events_insert_own ON public.funnel_events;
CREATE POLICY funnel_events_insert_own ON public.funnel_events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.funnel_events FROM anon;
GRANT INSERT ON public.funnel_events TO authenticated;
