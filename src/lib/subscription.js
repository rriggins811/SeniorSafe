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
