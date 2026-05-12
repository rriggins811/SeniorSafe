-- Maggie consolidation: per-family AI budget tracking with hard caps.
-- Phase A of the Maggie Consolidation build (branch: maggie-consolidation).
-- See: Marketing & Growth/Maggie_Consolidation/01_Architectural_Spec.md
--
-- Additive only. NO destructive changes:
--   - new table:      ai_user_budgets (per family_code, per month)
--   - new functions:  calculate_dollars_spent, tier_to_budget_dollars,
--                     upsert_ai_budget_row, log_maggie_call, seed_monthly_budgets
--   - new cron:       ai-budget-monthly-seed (1st of month, 00:05 UTC)
--   - new prompt row: maggie_prompts.system_prompt_daily_v1
--
-- Untouched: ai_usage, maggie_usage, existing maggie_prompts rows, user_profile,
--            ai_conversations, ai_messages, maggie_conversations, maggie_messages.
--
-- Feature flag (edge function side, NOT in this migration): the maggie-chat
-- edge function reads env MAGGIE_CONSOLIDATION_ENABLED. When false, the new
-- tables/functions still receive writes (telemetry) but the function does NOT
-- gate calls on budget_exceeded_at.

-- ============================================================================
-- 1. ai_user_budgets — per-FAMILY monthly token + dollar tracking
-- ============================================================================
-- Keyed on family_code (TEXT) to match ai_usage. All members of a family
-- share one budget row per month. Tier is captured at row creation and
-- updated if the family upgrades mid-month (downgrade does NOT shrink the
-- current month's budget — no claw-back).

CREATE TABLE IF NOT EXISTS public.ai_user_budgets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code text        NOT NULL,
  month       text        NOT NULL,                      -- 'YYYY-MM'
  tier        text        NOT NULL CHECK (tier IN ('trial', 'paid', 'premium_plus')),

  -- Haiku 4.5 (SeniorSafe daily / Paid-tier Maggie when consolidation ON)
  haiku_input_tokens            bigint NOT NULL DEFAULT 0,
  haiku_output_tokens           bigint NOT NULL DEFAULT 0,
  haiku_cache_read_tokens       bigint NOT NULL DEFAULT 0,
  haiku_cache_creation_tokens   bigint NOT NULL DEFAULT 0,

  -- Sonnet 4.6 (Premium+ Maggie / Trial Maggie)
  sonnet_input_tokens           bigint NOT NULL DEFAULT 0,
  sonnet_output_tokens          bigint NOT NULL DEFAULT 0,
  sonnet_cache_read_tokens      bigint NOT NULL DEFAULT 0,
  sonnet_cache_creation_tokens  bigint NOT NULL DEFAULT 0,

  -- Running total + cap
  total_dollars_spent NUMERIC(10, 4) NOT NULL DEFAULT 0,
  budget_dollars      NUMERIC(10, 4) NOT NULL,

  -- Tripwires (set once on first crossing, never reset within a month)
  warning_80_sent_at TIMESTAMPTZ DEFAULT NULL,
  budget_exceeded_at TIMESTAMPTZ DEFAULT NULL,

  -- Audit
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_family_month UNIQUE (family_code, month)
);

CREATE INDEX IF NOT EXISTS idx_ai_budgets_family_month
  ON public.ai_user_budgets (family_code, month);
CREATE INDEX IF NOT EXISTS idx_ai_budgets_month
  ON public.ai_user_budgets (month);

ALTER TABLE public.ai_user_budgets ENABLE ROW LEVEL SECURITY;

-- Family members can read their own family's budget row. Mirrors the
-- family_context / maggie_alerts policy pattern (direct family_code +
-- admin-via-invited_by).
CREATE POLICY "family members can read their family's budget"
  ON public.ai_user_budgets FOR SELECT
  USING (
    family_code IN (
      SELECT family_code FROM public.user_profile WHERE user_id = auth.uid()
      UNION
      SELECT family_code FROM public.user_profile
      WHERE user_id = (
        SELECT invited_by FROM public.user_profile WHERE user_id = auth.uid()
      )
    )
  );

-- Writes are service-role only (edge function). No INSERT/UPDATE/DELETE
-- policies = locked for end users.

COMMENT ON TABLE public.ai_user_budgets IS
  'Per-family monthly AI budget tracking. Phase A of Maggie Consolidation (May 2026).';


-- ============================================================================
-- 2. Pricing functions
-- ============================================================================
-- 2026 Anthropic pricing per M tokens (5-min ephemeral cache TTL):
--   Haiku 4.5:   input $1.00  | output $5.00  | cache_read $0.10 | cache_create $1.25
--   Sonnet 4.6:  input $3.00  | output $15.00 | cache_read $0.30 | cache_create $3.75
-- Cache_create is 1.25x base input price. Spec omitted these columns;
-- including them so monthly accounting actually matches Anthropic invoices.

CREATE OR REPLACE FUNCTION public.calculate_dollars_spent(
  haiku_input          bigint,
  haiku_output         bigint,
  haiku_cache_read     bigint,
  haiku_cache_create   bigint,
  sonnet_input         bigint,
  sonnet_output        bigint,
  sonnet_cache_read    bigint,
  sonnet_cache_create  bigint
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ROUND(
      (haiku_input         *  1.00 / 1000000.0)
    + (haiku_output        *  5.00 / 1000000.0)
    + (haiku_cache_read    *  0.10 / 1000000.0)
    + (haiku_cache_create  *  1.25 / 1000000.0)
    + (sonnet_input        *  3.00 / 1000000.0)
    + (sonnet_output       * 15.00 / 1000000.0)
    + (sonnet_cache_read   *  0.30 / 1000000.0)
    + (sonnet_cache_create *  3.75 / 1000000.0),
    4
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tier_to_budget_dollars(p_tier text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'premium_plus' THEN 12.00
    WHEN 'paid'         THEN  4.00
    WHEN 'trial'        THEN  4.00
    ELSE 0.00
  END::numeric;
$$;


-- ============================================================================
-- 3. upsert_ai_budget_row — lazy row creation + mid-month tier sync
-- ============================================================================
-- Edge fn calls this at the top of every Maggie/ai-chat request. Creates the
-- row on first call of the month, expands budget if family upgraded
-- mid-month (downgrade does NOT shrink — no claw-back). Returns the row so
-- caller can immediately gate on budget_exceeded_at.

CREATE OR REPLACE FUNCTION public.upsert_ai_budget_row(
  p_family_code text,
  p_tier        text,
  p_month       text
) RETURNS public.ai_user_budgets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ai_user_budgets;
  v_budget numeric;
BEGIN
  v_budget := public.tier_to_budget_dollars(p_tier);

  INSERT INTO public.ai_user_budgets (family_code, month, tier, budget_dollars)
  VALUES (p_family_code, p_month, p_tier, v_budget)
  ON CONFLICT (family_code, month) DO UPDATE
    SET tier           = EXCLUDED.tier,
        budget_dollars = GREATEST(public.ai_user_budgets.budget_dollars, EXCLUDED.budget_dollars),
        last_updated   = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


-- ============================================================================
-- 4. log_maggie_call — atomic usage logger + threshold tripwires
-- ============================================================================
-- Called after each Anthropic call completes (in the stream-finally block).
-- Adds tokens to the right model columns, recomputes total_dollars_spent,
-- sets warning_80_sent_at if newly crossing 80%, budget_exceeded_at if newly
-- crossing 100%. Returns the updated row.

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
AS $$
DECLARE
  v_row public.ai_user_budgets;
BEGIN
  IF p_model NOT IN ('haiku', 'sonnet') THEN
    RAISE EXCEPTION 'log_maggie_call: unsupported model %', p_model;
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

  -- Tripwires: set once on first crossing
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
$$;


-- ============================================================================
-- 5. seed_monthly_budgets — bulk row creation for pg_cron
-- ============================================================================
-- Pure SQL function. No HTTP / Vault dependency (unlike trial-downgrade-daily
-- and ai-cleanup-daily which both silently failed on launch — see
-- 20260508 migration notes). Idempotent via ON CONFLICT.
-- Pre-seeds rows so dashboards can show "expected spend pool" at the
-- start of each month before anyone has hit Maggie.

CREATE OR REPLACE FUNCTION public.seed_monthly_budgets()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := to_char(CURRENT_DATE, 'YYYY-MM');
  v_inserted int;
BEGIN
  WITH active_families AS (
    SELECT family_code, subscription_tier AS tier
    FROM public.user_profile
    WHERE invited_by IS NULL                  -- admin row holds the family's tier
      AND family_code IS NOT NULL
      AND subscription_tier IN ('trial', 'paid', 'premium_plus')
  ), inserted AS (
    INSERT INTO public.ai_user_budgets (family_code, month, tier, budget_dollars)
    SELECT family_code,
           v_month,
           tier,
           public.tier_to_budget_dollars(tier)
    FROM active_families
    ON CONFLICT (family_code, month) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RAISE NOTICE 'seed_monthly_budgets: inserted % new rows for month %', v_inserted, v_month;
  RETURN v_inserted;
END;
$$;


-- ============================================================================
-- 6. pg_cron schedule: ai-budget-monthly-seed at 00:05 UTC on the 1st
-- ============================================================================
-- Direct SQL call. No Vault / no http_post — cleaner than the trial-downgrade
-- pattern, no silent-failure risk. Defense in depth: upsert_ai_budget_row
-- lazily creates the row on first call anyway, so this cron is a pre-seed
-- for monitoring, not a correctness dependency.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-budget-monthly-seed') THEN
    PERFORM cron.unschedule('ai-budget-monthly-seed');
  END IF;
END $$;

SELECT cron.schedule(
  'ai-budget-monthly-seed',
  '5 0 1 * *',
  $cron$ SELECT public.seed_monthly_budgets(); $cron$
);


-- ============================================================================
-- 7. INSERT Maggie Daily prompt row (Haiku 4.5, Paid tier)
-- ============================================================================
-- New key 'system_prompt_daily_v1'. The existing 'system_prompt_v1' row
-- (Maggie Pro / Sonnet 4.6) is UNTOUCHED.

INSERT INTO public.maggie_prompts (name, content)
VALUES (
  'system_prompt_daily_v1',
  $maggie_daily$
# Maggie — Daily Mode (Premium tier)

You are **Maggie**, the SeniorSafe everyday AI for Premium-tier users.

You're the same Maggie that handles deeper Premium+ work — just in a lighter, daily-chat mode here. You sound like a kind neighbor at the kitchen table, not a textbook.

## What you help with

- Day-to-day senior life: meals, recipes, medication reminders, weather, small errands
- Family check-ins ("Mom called, here's what she said")
- Quick household help: a thank-you note, a birthday card, a phone-number lookup
- Light eldercare awareness — if a topic touches a senior's care (a slip in the kitchen, a missed med, a confusing letter from Medicare), respond with warmth and practical next-step language, then pause
- General questions: trivia, tech help, recipe substitutions, anything reasonable

## When a question is bigger than daily mode

If someone asks about real transition territory — Medicare planning, when to move a parent, how to talk to a sibling about money, what to do when a parent won't sign anything, predator-buyer offers, estate planning, long-term care funding, deep emotional family disputes — recognize that this is bigger than daily chat. Say something like:

> "That's a real one — bigger than I want to handle here. The full Senior Transition Blueprint walks through exactly this, step by step. If you'd like to chat with the Premium+ version of me — same Maggie, trained on the full Blueprint methodology — you can upgrade in your account settings."

Don't be pushy about it. Once is enough. If they push back ("just answer it"), say "honestly, the Pro version of me would do a better job here, but I can give you a starting frame" — then offer one short, careful paragraph and stop. Don't overreach.

## Voice rules

- Warm, direct, plain. Short paragraphs. Short sentences.
- Use the person's first name when you know it. Don't overuse.
- Don't open with "I sat at the kitchen table with..." or any other anecdote opener.
- Never use these words/phrases: "journey", "leverage", "deep dive", "game-changer", "navigate" (as a verb in a marketing sense — "help you navigate" is banned).
- Never say "As an AI" or "I'm just a language model." Just help.
- If you're unsure of a detail, say so. Don't invent.

## Never

- Give medical advice, diagnose, or interpret labs / imaging / test results
- Recommend starting, stopping, or changing a medication or dose
- Give specific legal advice or name a specific attorney/firm
- Give specific financial or investment advice or name a product
- Recommend a specific Medicare plan, supplement, insurance product, or financial advisor
- Speculate on Ryan's family or anyone else's private health

If asked a medical question: "I can't give medical advice — that's a doctor question. But I can help you put together a list of questions for the next appointment. Want to do that?"

If asked a legal/financial question that's specific: "That's an elder law attorney's job (or a fee-only CFP for finance). I can help you organize the questions before the call."

## Format defaults

- 2–4 short sentences for most replies
- Use a short bulleted list only when steps or comparisons help
- No headers. No bold. No emojis unless the user uses them first.

## When in doubt

Be kind. Be brief. If the question feels heavy, slow down and acknowledge it before answering. You are not in a hurry.
$maggie_daily$
)
ON CONFLICT (name) DO UPDATE
  SET content    = EXCLUDED.content,
      updated_at = NOW();
