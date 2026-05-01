import { Purchases } from '@revenuecat/purchases-capacitor'
import { Capacitor } from '@capacitor/core'

const APPLE_API_KEY = 'appl_TzwbAuYsqyTfHLRocmJpjzNSPnL'
const ANDROID_API_KEY = 'goog_FpPwzuruOoVoRGRxFWbkKMudxgq'

// Entitlement IDs as configured in the RevenueCat dashboard.
// Premium+ users only have PREMIUM_PLUS_ENTITLEMENT_ID — they do NOT also
// have PREMIUM_ENTITLEMENT_ID. So any "is the user paid?" check has to be
// EITHER-OR across both entitlements (see checkEntitlement below).
const PREMIUM_ENTITLEMENT_ID = 'SeniorSafeApp Pro'
const PREMIUM_PLUS_ENTITLEMENT_ID = 'premium_plus'

// Package identifier in the RevenueCat default offering for Premium+ monthly.
const PREMIUM_PLUS_PACKAGE_ID = 'premium_plus_monthly'

// Apple/Google product IDs — exported so callers can forward them to the
// mark-iap-paid edge function when RevenueCat customerInfo is missing the
// productIdentifier (e.g. very early customerInfo state right after purchase).
export const PREMIUM_PRODUCT_ID = 'com.rigginsstrategicsolutions.seniorsafe.monthly'
export const PREMIUM_PLUS_PRODUCT_ID = 'com.rigginsstrategicsolutions.seniorsafe.premiumplus.monthly'

export function isNativePlatform() {
  const platform = Capacitor.getPlatform()
  return platform === 'ios' || platform === 'android'
}

export async function initializePurchases() {
  const platform = Capacitor.getPlatform()
  if (platform === 'web') return

  const apiKey = platform === 'ios' ? APPLE_API_KEY : ANDROID_API_KEY
  await Purchases.configure({ apiKey })
}

export async function purchaseMonthly() {
  const offerings = await Purchases.getOfferings()
  if (!offerings?.current?.monthly) {
    throw new Error('Subscription not available right now. Please try again later.')
  }

  const result = await Purchases.purchasePackage({ aPackage: offerings.current.monthly })
  return result.customerInfo
}

// Build 27: Premium+ purchase. The Premium+ package lives in the same
// RevenueCat offering as Premium ("current"), keyed by identifier. When a
// user goes Premium → Premium+, Apple StoreKit handles the upgrade
// proration automatically because both products are in the same Apple
// subscription group (ID 22003343). Same for Google Play once the Android
// session attaches a Play Store product to the package.
export async function purchasePremiumPlus() {
  const offerings = await Purchases.getOfferings()
  const pkg = offerings?.current?.availablePackages?.find(
    p => p.identifier === PREMIUM_PLUS_PACKAGE_ID
  )
  if (!pkg) {
    throw new Error('Premium+ subscription not available right now. Please try again later.')
  }

  const result = await Purchases.purchasePackage({ aPackage: pkg })
  return result.customerInfo
}

// "Is the user entitled to ANY paid features?" — used to gate Premium-tier
// features (family alerts, vault, etc.). Premium+ users don't have the
// Premium entitlement, so we must check both.
export async function checkEntitlement() {
  const { customerInfo } = await Purchases.getCustomerInfo()
  const active = customerInfo.entitlements.active
  return active[PREMIUM_ENTITLEMENT_ID] !== undefined
      || active[PREMIUM_PLUS_ENTITLEMENT_ID] !== undefined
}

// "Is the user entitled to Premium+ features specifically?" — used to gate
// the Maggie tab and other Premium+-only features.
export async function checkPremiumPlusEntitlement() {
  const { customerInfo } = await Purchases.getCustomerInfo()
  return customerInfo.entitlements.active[PREMIUM_PLUS_ENTITLEMENT_ID] !== undefined
}

export async function restorePurchases() {
  const { customerInfo } = await Purchases.restorePurchases()
  return customerInfo
}
