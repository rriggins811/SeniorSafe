import { getAttribution } from './attribution'
import { isIOS, isAndroid } from './platform'

// What SignUpPage stashes in localStorage before a Google / Apple redirect so
// OnboardingPage can finish the right kind of profile afterwards.
export const PENDING_SIGNUP_KEY = 'seniorsafe_pending_signup'

export function detectDevicePlatform() {
  if (isIOS()) return 'ios'
  if (isAndroid()) return 'android'
  return 'web'
}

// Everything a brand-new profile row needs regardless of who is signing up.
export function baseProfileRow(userId) {
  return {
    user_id: userId,
    signup_source: getAttribution(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    device_platform: detectDevicePlatform(),
    // Free forever from day one (2026-09-08). Nobody starts on top, so
    // nobody is ever downgraded. The paid plan is a lock tap away.
    subscription_tier: 'free',
    trial_status: 'none',
  }
}
