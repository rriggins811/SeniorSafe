/**
 * Check if a subscription tier has premium access.
 * 'paid' and 'trial' grant the paid plan. 'premium_plus' is legacy, treated as paid.
 */
export function isPremium(tier) {
  return tier === 'paid' || tier === 'trial' || tier === 'premium_plus'
}

// 2026-09-04: one assistant, two plans (free and paid). 'premium_plus' is a
// legacy value that a few old rows or receipts may still carry; treat it as
// paid. Maggie is available on every plan; the server enforces the free
// plan's 10-messages-ever limit.

/**
 * Calculate trial days remaining from trial_start_date.
 * Returns null if not in trial, 0 if expired.
 */
export function trialDaysRemaining(trialStartDate) {
  if (!trialStartDate) return null
  const start = new Date(trialStartDate)
  const now = new Date()
  const elapsed = Math.floor((now - start) / (1000 * 60 * 60 * 24))
  const remaining = 14 - elapsed
  return remaining < 0 ? 0 : remaining
}

// ---------------------------------------------------------------------------
// Card-on-file trial (2026-09-08).
// Every family owner who signs up from the cutover on puts a card down before
// setup: 14 days free, then $14.99 a month, cancel anytime. The billing
// platform (Stripe on the web, Apple or Google in the apps) ends the trial by
// charging the card; the nightly trial-downgrade job only handles the older
// no-card trials. "Free" is where a family lands after a cancel or a failed
// card, never a plan you can sign up for.
// ---------------------------------------------------------------------------
export const BILLING_CUTOVER = '2026-09-08T00:00:00Z'
export const TRIAL_DAYS = 14
export const MONTHLY_PRICE = '$14.99'

// Has this owner ever put a card down (Stripe, Apple, or Google)?
export function billingStarted(p) {
  if (!p) return false
  return Boolean(
    p.stripe_subscription_id ||
    p.apple_original_transaction_id ||
    p.google_original_transaction_id ||
    p.subscription_tier === 'paid' ||
    p.subscription_tier === 'premium_plus',
  )
}

// Owners created from the cutover on must start their trial (card on file)
// before they reach setup or the home screen. Members and seniors never pay.
export function needsBilling(p) {
  if (!p || p.role !== 'admin' || p.is_test) return false
  if (!p.created_at || new Date(p.created_at) < new Date(BILLING_CUTOVER)) return false
  return !billingStarted(p)
}

// The family had a trial or a paid plan and it ended. Drives the "your plan
// ended" banner so nobody drifts onto the free plan without noticing.
export function planEnded(owner) {
  if (!owner) return false
  if (owner.subscription_tier !== 'free') return false
  return owner.trial_status === 'expired' || owner.trial_status === 'converted' || Boolean(owner.stripe_subscription_id)
}

// First charge date for a card-on-file trial, as a readable string.
export function firstChargeLabel(p) {
  const iso = p?.subscription_period_end || (p?.trial_start_date
    ? new Date(new Date(p.trial_start_date).getTime() + TRIAL_DAYS * 86400000).toISOString()
    : null)
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}
