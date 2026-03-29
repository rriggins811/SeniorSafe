/**
 * Apple In-App Purchase service for SeniorSafe iOS app.
 *
 * Uses cordova-plugin-purchase which injects `window.CdvPurchases`
 * at runtime on native iOS devices. This module is safe to import
 * on web — all functions no-op when not on iOS.
 */
import { isIOS } from './platform'
import { supabase } from './supabase'

const PRODUCT_ID = 'com.rigginsstrategicsolutions.seniorsafe.monthly'
const VERIFY_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/verify-apple-purchase'

let store = null
let initialized = false

// Callbacks that UpgradePage can register to react to purchase results
let onPurchaseSuccess = null
let onPurchaseError = null

export function setIAPCallbacks({ onSuccess, onError }) {
  onPurchaseSuccess = onSuccess
  onPurchaseError = onError
}

/**
 * Send receipt to our edge function for server-side verification.
 * On success the edge function updates subscription_tier in the DB.
 */
async function verifyReceipt(receipt) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not logged in')

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ receipt }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Receipt verification failed')
    }

    return true
  } catch (err) {
    console.error('IAP verify error:', err)
    throw err
  }
}

/**
 * Initialize the IAP store. Call once on app startup.
 * Only runs on iOS — no-ops everywhere else.
 */
export function initializeIAP() {
  if (!isIOS()) return
  if (initialized) return

  // CdvPurchases is injected by cordova-plugin-purchase at runtime
  store = window.CdvPurchases?.store
  if (!store) {
    console.warn('IAP: CdvPurchases.store not available')
    return
  }

  initialized = true

  // Set log level (INFO for dev, QUIET for prod)
  store.verbosity = store.LogLevel?.INFO || 1

  // Register the monthly subscription product
  store.register([{
    id: PRODUCT_ID,
    type: store.ProductType?.PAID_SUBSCRIPTION || 'paid subscription',
    platform: store.Platform?.APPLE_APPSTORE || 'ios-appstore',
  }])

  // When a purchase is approved, verify the receipt server-side
  store.when()
    .approved(async (transaction) => {
      try {
        // Get the receipt from the transaction
        const receipt = transaction.parentReceipt?.nativeData?.appStoreReceipt
          || transaction.transactionId

        await verifyReceipt(receipt)
        transaction.finish()

        if (onPurchaseSuccess) onPurchaseSuccess()
      } catch (err) {
        console.error('IAP: verification failed after approval', err)
        if (onPurchaseError) onPurchaseError(err.message || 'Purchase verification failed. Please contact support.')
      }
    })
    .finished((transaction) => {
      // Transaction completed and acknowledged
      console.log('IAP: transaction finished', transaction.transactionId)
    })

  // Handle errors
  store.error((err) => {
    console.error('IAP store error:', err)
    // Don't alert on user cancellation
    if (err.code === store.ErrorCode?.PAYMENT_CANCELLED) return
    if (onPurchaseError) onPurchaseError(err.message || 'Purchase failed. Please try again.')
  })

  // Initialize — connects to Apple and loads products
  store.initialize([
    store.Platform?.APPLE_APPSTORE || 'ios-appstore',
  ])
}

/**
 * Start a monthly subscription purchase.
 */
export function purchaseMonthly() {
  if (!store) {
    alert('In-app purchases are not available. Please try again later.')
    return
  }

  const product = store.get(PRODUCT_ID)
  if (!product) {
    alert('Subscription product not found. Please try again later.')
    return
  }

  store.order(product.getOffer())
}

/**
 * Restore previous purchases (e.g. after reinstall or new device).
 */
export async function restorePurchases() {
  if (!store) {
    alert('In-app purchases are not available.')
    return
  }

  try {
    await store.restorePurchases()
  } catch (err) {
    console.error('IAP restore error:', err)
    alert('Could not restore purchases. Please try again later.')
  }
}
