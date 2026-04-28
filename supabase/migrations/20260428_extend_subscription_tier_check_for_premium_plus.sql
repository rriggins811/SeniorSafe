-- The original Maggie migration (20260428_add_maggie_premium_plus_tier.sql) added
-- 'premium_plus' as a documented tier value but the existing
-- user_profile.subscription_tier_check constraint only allowed
-- ('free', 'paid', 'trial'). This extends it so RevenueCat or manual flips
-- can write 'premium_plus' to the column.
-- Applied to production via Supabase MCP on April 28, 2026.

ALTER TABLE public.user_profile
  DROP CONSTRAINT IF EXISTS subscription_tier_check;

ALTER TABLE public.user_profile
  ADD CONSTRAINT subscription_tier_check
  CHECK (subscription_tier = ANY (ARRAY['free'::text, 'paid'::text, 'trial'::text, 'premium_plus'::text]));
