-- Fixup for 20260512_maggie_consolidation.sql.
-- Bug found in ST6 smoke test: on tier downgrade mid-month
-- (e.g. premium_plus → paid), upsert_ai_budget_row was correctly preserving
-- the larger budget_dollars (no claw-back, per spec) but was OVERWRITING the
-- `tier` column to the new lower tier. Result: a row with tier='paid' and
-- budget_dollars=$12, which breaks analytics queries that pivot on tier.
--
-- Fix: only update the `tier` column when the incoming tier's budget EXPANDS
-- the row. Downgrades preserve both the dollar cap AND the tier label until
-- next month, when seed_monthly_budgets / lazy upsert creates a fresh row at
-- the family's current tier.

CREATE OR REPLACE FUNCTION public.upsert_ai_budget_row(
  p_family_code text,
  p_tier        text,
  p_month       text
) RETURNS public.ai_user_budgets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.ai_user_budgets;
  v_budget numeric;
BEGIN
  v_budget := public.tier_to_budget_dollars(p_tier);

  INSERT INTO public.ai_user_budgets (family_code, month, tier, budget_dollars)
  VALUES (p_family_code, p_month, p_tier, v_budget)
  ON CONFLICT (family_code, month) DO UPDATE
    SET tier           = CASE
                           WHEN EXCLUDED.budget_dollars > public.ai_user_budgets.budget_dollars
                           THEN EXCLUDED.tier
                           ELSE public.ai_user_budgets.tier
                         END,
        budget_dollars = GREATEST(public.ai_user_budgets.budget_dollars, EXCLUDED.budget_dollars),
        last_updated   = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;
