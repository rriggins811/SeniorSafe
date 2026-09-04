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
    subscription_tier: 'trial',
    trial_status: 'active',
    trial_start_date: new Date().toISOString(),
  }
}
