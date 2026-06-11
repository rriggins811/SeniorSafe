-- 2026-06-11 (security audit #1/#2): rate-limit the invite-code lookup oracle.
--
-- lookup_invite_code maps a 6-char family_code -> family admin user_id + family_name
-- and is anon-callable (the pre-signup invite screen needs it). Unthrottled, it was a
-- brute-force oracle: a script guesses codes, gets a real family's admin user_id, and
-- (because invited_by is client-set at signup) forges family membership to read that
-- family's check-ins / meds / messages / vault docs. This caps lookups per network so
-- the code space can't be enumerated.
--
-- SAFETY: fails OPEN if the caller IP is unreadable (confirmed cf-connecting-ip +
-- x-forwarded-for are present via PostgREST, so this can't happen in practice) — a
-- missing header must never block a legitimate sign-up. Return shape is UNCHANGED
-- (backward-compatible with the current web + native clients). Verified live via curl:
-- lookups 1-30 succeed, #31+ are throttled.
--
-- FOLLOW-UP (pairs with the app rebuild): stop returning user_id and move membership
-- binding into a server-side join_family(code) RPC + a BEFORE INSERT lock on invited_by,
-- so the client can never assert family membership at all (defense in depth).
CREATE TABLE IF NOT EXISTS public.invite_code_lookup_log (
  ip           text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0
);
ALTER TABLE public.invite_code_lookup_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invite_code_lookup_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.lookup_invite_code(invite_code text)
 RETURNS TABLE(user_id uuid, family_name text)
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
  SELECT up.user_id, up.family_name
  FROM public.user_profile up
  WHERE up.family_code = upper(trim(invite_code))
  LIMIT 1;
END;
$function$;
