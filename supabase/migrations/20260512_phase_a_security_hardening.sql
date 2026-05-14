-- Phase A security hardening sweep (May 12, 2026).
-- Bundled fix for three issues caught during the post-launch security review:
--
--   Issue 1 (CRITICAL) — Original migration left log_maggie_call /
--     upsert_ai_budget_row / seed_monthly_budgets / calculate_dollars_spent /
--     tier_to_budget_dollars with default Postgres EXECUTE for PUBLIC,
--     which on Supabase grants anon + authenticated roles direct call
--     access via PostgREST. SECURITY DEFINER on the three mutating
--     functions made this critical: an authenticated user could pass
--     negative token deltas to log_maggie_call to erase their family's
--     spend, or upsert their budget row with tier='premium_plus' to
--     escalate their cap from $4 to $12.
--
--     REVOKE statements below were already applied live before this
--     migration committed (urgent fix). Statements are kept here so the
--     git record is reproducible — REVOKE is idempotent.
--
--   Issue 2 (MEDIUM) — Concurrent-request budget overshoot. Accepted
--     under current load (bounded by daily cap + Anthropic deposit).
--     Not addressed in this migration. Tracked post-cram: rebuild
--     log_maggie_call as atomic check-and-increment.
--
--   Issue 3 (LOW, defense in depth):
--     A) CHECK constraints on the 8 token columns of ai_user_budgets
--        so no path — RPC, direct SQL, or RLS bypass — can store
--        negative token counts that would corrupt dollar math.
--     B) Input validation inside log_maggie_call: reject negative token
--        deltas at the RPC boundary before they touch the row. Belt to
--        the CHECK suspenders.
--
-- All changes additive / hardening only. No behavior change for legitimate
-- service_role callers (the edge functions).

-- ============================================================================
-- 1. REVOKE EXECUTE from authenticated, anon, public (Issue 1)
-- ============================================================================
-- Already applied live. Kept here for git reproducibility.

REVOKE EXECUTE ON FUNCTION public.log_maggie_call(text, text, text, bigint, bigint, bigint, bigint)
  FROM authenticated, anon, public;

REVOKE EXECUTE ON FUNCTION public.upsert_ai_budget_row(text, text, text)
  FROM authenticated, anon, public;

REVOKE EXECUTE ON FUNCTION public.seed_monthly_budgets()
  FROM authenticated, anon, public;

REVOKE EXECUTE ON FUNCTION public.calculate_dollars_spent(bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint)
  FROM authenticated, anon, public;

REVOKE EXECUTE ON FUNCTION public.tier_to_budget_dollars(text)
  FROM authenticated, anon, public;


-- ============================================================================
-- 2. CHECK constraints on token columns (Issue 3A)
-- ============================================================================
-- Defense in depth: even if a future RPC or direct-SQL path tries to write
-- a negative delta, the row update fails before corrupting dollar math.
-- IF NOT EXISTS so re-applying the migration is idempotent.

ALTER TABLE public.ai_user_budgets
  ADD CONSTRAINT haiku_input_nonneg          CHECK (haiku_input_tokens          >= 0),
  ADD CONSTRAINT haiku_output_nonneg         CHECK (haiku_output_tokens         >= 0),
  ADD CONSTRAINT haiku_cache_read_nonneg     CHECK (haiku_cache_read_tokens     >= 0),
  ADD CONSTRAINT haiku_cache_creation_nonneg CHECK (haiku_cache_creation_tokens >= 0),
  ADD CONSTRAINT sonnet_input_nonneg         CHECK (sonnet_input_tokens         >= 0),
  ADD CONSTRAINT sonnet_output_nonneg        CHECK (sonnet_output_tokens        >= 0),
  ADD CONSTRAINT sonnet_cache_read_nonneg    CHECK (sonnet_cache_read_tokens    >= 0),
  ADD CONSTRAINT sonnet_cache_creation_nonneg CHECK (sonnet_cache_creation_tokens >= 0);


-- ============================================================================
-- 3. log_maggie_call — add input validation (Issue 3B)
-- ============================================================================
-- All four token deltas must be non-negative. Belt to the CHECK suspenders.
-- The rest of the function body is byte-for-byte identical to the version
-- shipped in 20260512_maggie_consolidation.sql.

CREATE OR REPLACE FUNCTION public.log_maggie_call(
  p_family_code         text,
  p_month               text,
  p_model               text,    -- 'haiku' or 'sonnet'
  p_input_tokens        bigint,
  p_output_tokens       bigint,
  p_cache_read_tokens   bigint,
  p_cache_create_tokens bigint
) RETURNS public.ai_user_budgets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.ai_user_budgets;
BEGIN
  IF p_model NOT IN ('haiku', 'sonnet') THEN
    RAISE EXCEPTION 'log_maggie_call: unsupported model %', p_model;
  END IF;

  -- NEW (Phase A security hardening): reject negative token deltas at the
  -- RPC boundary so a buggy or malicious caller can never decrement a
  -- family's spend. The CHECK constraints on the row catch this too, but
  -- failing early here gives a cleaner error.
  IF p_input_tokens < 0 OR p_output_tokens < 0
     OR p_cache_read_tokens < 0 OR p_cache_create_tokens < 0 THEN
    RAISE EXCEPTION 'log_maggie_call: token deltas must be non-negative (input=%, output=%, cache_read=%, cache_create=%)',
      p_input_tokens, p_output_tokens, p_cache_read_tokens, p_cache_create_tokens;
  END IF;

  UPDATE public.ai_user_budgets
  SET
    haiku_input_tokens           = haiku_input_tokens
        + CASE WHEN p_model = 'haiku'  THEN p_input_tokens        ELSE 0 END,
    haiku_output_tokens          = haiku_output_tokens
        + CASE WHEN p_model = 'haiku'  THEN p_output_tokens       ELSE 0 END,
    haiku_cache_read_tokens      = haiku_cache_read_tokens
        + CASE WHEN p_model = 'haiku'  THEN p_cache_read_tokens   ELSE 0 END,
    haiku_cache_creation_tokens  = haiku_cache_creation_tokens
        + CASE WHEN p_model = 'haiku'  THEN p_cache_create_tokens ELSE 0 END,
    sonnet_input_tokens          = sonnet_input_tokens
        + CASE WHEN p_model = 'sonnet' THEN p_input_tokens        ELSE 0 END,
    sonnet_output_tokens         = sonnet_output_tokens
        + CASE WHEN p_model = 'sonnet' THEN p_output_tokens       ELSE 0 END,
    sonnet_cache_read_tokens     = sonnet_cache_read_tokens
        + CASE WHEN p_model = 'sonnet' THEN p_cache_read_tokens   ELSE 0 END,
    sonnet_cache_creation_tokens = sonnet_cache_creation_tokens
        + CASE WHEN p_model = 'sonnet' THEN p_cache_create_tokens ELSE 0 END,
    total_dollars_spent = public.calculate_dollars_spent(
        haiku_input_tokens           + CASE WHEN p_model = 'haiku'  THEN p_input_tokens        ELSE 0 END,
        haiku_output_tokens          + CASE WHEN p_model = 'haiku'  THEN p_output_tokens       ELSE 0 END,
        haiku_cache_read_tokens      + CASE WHEN p_model = 'haiku'  THEN p_cache_read_tokens   ELSE 0 END,
        haiku_cache_creation_tokens  + CASE WHEN p_model = 'haiku'  THEN p_cache_create_tokens ELSE 0 END,
        sonnet_input_tokens          + CASE WHEN p_model = 'sonnet' THEN p_input_tokens        ELSE 0 END,
        sonnet_output_tokens         + CASE WHEN p_model = 'sonnet' THEN p_output_tokens       ELSE 0 END,
        sonnet_cache_read_tokens     + CASE WHEN p_model = 'sonnet' THEN p_cache_read_tokens   ELSE 0 END,
        sonnet_cache_creation_tokens + CASE WHEN p_model = 'sonnet' THEN p_cache_create_tokens ELSE 0 END
    ),
    last_updated = NOW()
  WHERE family_code = p_family_code AND month = p_month
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'log_maggie_call: no budget row for family_code=% month=% (call upsert_ai_budget_row first)',
      p_family_code, p_month;
  END IF;

  IF v_row.total_dollars_spent >= (v_row.budget_dollars * 0.8) AND v_row.warning_80_sent_at IS NULL THEN
    UPDATE public.ai_user_budgets
       SET warning_80_sent_at = NOW()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.total_dollars_spent >= v_row.budget_dollars AND v_row.budget_exceeded_at IS NULL THEN
    UPDATE public.ai_user_budgets
       SET budget_exceeded_at = NOW()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$fn$;

-- Re-apply REVOKE on the recreated function (CREATE OR REPLACE preserves
-- ACL but be explicit so the migration's intent is unambiguous if applied
-- on a fresh DB that doesn't carry the pre-existing REVOKE state).
REVOKE EXECUTE ON FUNCTION public.log_maggie_call(text, text, text, bigint, bigint, bigint, bigint)
  FROM authenticated, anon, public;
