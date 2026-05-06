/**
 * Check if a subscription tier has premium access.
 * 'paid', 'trial', and 'premium_plus' all grant full Premium feature access.
 */
export function isPremium(tier) {
  return tier === 'paid' || tier === 'trial' || tier === 'premium_plus'
}

/**
 * Premium+ tier ($39.99/month) unlocks Maggie AI as a paid entitlement.
 * Stays narrowly scoped to the paid tier — used by RevenueCat / billing UI.
 */
export function isPremiumPlus(tier) {
  return tier === 'premium_plus'
}

/**
 * Maggie access gate. Premium+ paid users AND trial users (the 14-day
 * Blueprint-signup trial that grants the full Premium+ experience) both
 * unlock Maggie. Used by MaggiePage UI and the maggie-chat edge function.
 */
export function canAccessMaggie(tier) {
  return tier === 'premium_plus' || tier === 'trial'
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
