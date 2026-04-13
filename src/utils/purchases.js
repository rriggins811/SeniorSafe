import { Purchases } from '@revenuecat/purchases-capacitor'
import { Capacitor } from '@capacitor/core'

const APPLE_API_KEY = 'appl_TzwbAuYsqyTfHLRocmJpjzNSPnL'
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
  let offeringsResponse
  try {
    offeringsResponse = await Purchases.getOfferings()
  } catch (fetchErr) {
    throw new Error(`[RC-FETCH] ${fetchErr.message || JSON.stringify(fetchErr)}`)
  }

  const offerings = offeringsResponse?.offerings
  if (!offerings) {
    throw new Error(`[RC-NULL] offerings object is null/undefined. Raw: ${JSON.stringify(offeringsResponse).slice(0, 300)}`)
  }
  if (!offerings.current) {
    const keys = Object.keys(offerings).join(', ')
    throw new Error(`[RC-NO-CURRENT] offerings.current is null. Available keys: [${keys}]. Raw: ${JSON.stringify(offerings).slice(0, 300)}`)
  }
  if (!offerings.current.monthly) {
    const pkgKeys = Object.keys(offerings.current).join(', ')
    const availPkgs = offerings.current.availablePackages?.map(p => p.identifier).join(', ') || 'none'
    throw new Error(`[RC-NO-MONTHLY] No monthly package. Keys: [${pkgKeys}]. Packages: [${availPkgs}]`)
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
