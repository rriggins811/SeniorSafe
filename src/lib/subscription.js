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
// Free door (locked 2026-09-08 late morning, LOCKED_CONTEXT "SENIORSAFE MODEL").
// Signup is name, email, password, mobile. No card, no trial clock. Free
// forever: the daily check-in, one missed-check-in text to ONE family contact,
// I Need Help to that contact, push nudges, history, the senior invite,
// emergency card, medication reminders shown to the senior, Maggie 10
// messages ever. Everything for the whole family, the paperwork, and Maggie
// beyond a taste is paid, shown behind a lock: tap it, see the price, seven
// free days with a card (Stripe on the web; the store trials in the apps).
// Existing accounts keep what they have.
// ---------------------------------------------------------------------------
export const TASTE_DAYS = 7
export const MONTHLY_PRICE = '$14.99'

// The free plan's one family contact: the person who set the family up when
// they are not the senior, otherwise the first family member who joined.
export function primaryContact(family) {
  if (!family) return null
  if (family.owner && !family.owner.is_senior) return family.owner
  const members = (family.all || [])
    .filter(r => !r.is_senior && r.user_id !== family.ownerId)
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
  return members[0] || null
}

// The plan ended (a trial ran out or a subscription lapsed). Drives the
// banner so nobody assumes the paid alerts are still running.
export function planEnded(owner) {
  if (!owner) return false
  if (owner.subscription_tier !== 'free') return false
  return owner.trial_status === 'expired' || owner.trial_status === 'converted' || Boolean(owner.stripe_subscription_id)
}

// First charge date for a card-on-file taste, as a readable string.
export function firstChargeLabel(p) {
  const iso = p?.subscription_period_end
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

// Days left on a Stripe taste, from the trial end the webhook stored.
export function tasteDaysRemaining(p) {
  if (!p?.subscription_period_end || p.subscription_tier !== 'trial') return null
  const ms = new Date(p.subscription_period_end) - new Date()
  return Math.max(0, Math.ceil(ms / 86400000))
}
