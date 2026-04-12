import { Purchases } from '@revenuecat/purchases-capacitor'
import { Capacitor } from '@capacitor/core'

const APPLE_API_KEY = 'appl_OHVFNXVYMWMNtxNhUVcNjXqaLsz'
const ANDROID_API_KEY = 'ANDROID_KEY_PLACEHOLDER'
const ENTITLEMENT_ID = 'SeniorSafeApp Pro'

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
  const { offerings } = await Purchases.getOfferings()
  if (!offerings.current?.monthly) {
    throw new Error('Monthly subscription not available. Please try again later.')
  }

  const result = await Purchases.purchasePackage({ aPackage: offerings.current.monthly })
  return result.customerInfo
}

export async function checkEntitlement() {
  const { customerInfo } = await Purchases.getCustomerInfo()
  return customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined
}

export async function restorePurchases() {
  const { customerInfo } = await Purchases.restorePurchases()
  return customerInfo
}
