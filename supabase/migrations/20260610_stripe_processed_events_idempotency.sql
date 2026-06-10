-- 2026-06-10: Idempotency ledger for the blueprint Stripe webhook (auth hardening #6).
--
-- WHY: Stripe routinely re-delivers the same event (automatic retries, manual
-- re-sends from the dashboard, network blips). The blueprint webhook previously
-- re-ran its full write on every delivery, so a re-sent "payment complete" could
-- rewrite a customer's course_access and restart their Premium 90-day support
-- clock, and (if an older Core event was re-delivered after a Premium upgrade)
-- silently downgrade them.
--
-- The webhook now records each event.id here once (ON CONFLICT DO NOTHING); a
-- duplicate delivery finds the row already present and is skipped. Paired with
-- the never-lower-tier + keep-purchase-date logic in the webhook itself.
CREATE TABLE IF NOT EXISTS public.stripe_processed_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);

-- Public tables must have RLS on (house rule). No policies => only service_role
-- (which bypasses RLS, and is what the webhook's admin client uses) can touch it.
ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_processed_events FROM anon, authenticated;

COMMENT ON TABLE public.stripe_processed_events IS
  'Idempotency ledger for Stripe webhook events (blueprint-site). Service-role only.';
