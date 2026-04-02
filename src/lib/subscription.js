/**
 * Check if a subscription tier has premium access.
 * 'paid' and 'trial' both grant full access.
 */
export function isPremium(tier) {
  return tier === 'paid' || tier === 'trial'
}

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
