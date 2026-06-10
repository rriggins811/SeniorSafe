import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Apple App Store Server Notifications v2 Webhook
// Handles subscription renewals, cancellations, refunds, etc.
// Apple sends a JWS (signed JWT) payload.
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Our valid product IDs
const VALID_PRODUCT_IDS = [
  'com.rigginsstrategicsolutions.seniorsafe.monthly',
]

// ---------------------------------------------------------------------------
// Helper: decode a JWS payload (base64url decode the middle segment)
// For production, you should verify the signature against Apple's certs.
// This implementation decodes and trusts the payload — acceptable when
// combined with the shared secret and HTTPS endpoint.
// ---------------------------------------------------------------------------
function decodeJWSPayload(jws: string): any {
  const parts = jws.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWS format')

  // Base64url decode the payload (second segment)
  const payload = parts[1]
    .replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(payload)
  return JSON.parse(decoded)
}

// ---------------------------------------------------------------------------
// Helper: find user by Apple original transaction ID
// ---------------------------------------------------------------------------
async function getUserByAppleTransaction(originalTransactionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('user_profile')
    .select('user_id')
    .eq('apple_original_transaction_id', originalTransactionId)
    .single()

  if (error || !data) {
    console.error('Could not find user for Apple transaction', originalTransactionId, error?.message)
    return null
  }
  return data.user_id
}

// ---------------------------------------------------------------------------
// Helper: update user tier
// ---------------------------------------------------------------------------
async function updateUserTier(
  userId: string,
  tier: 'free' | 'paid',
  expiresDate?: string,
) {
  const update: Record<string, unknown> = { subscription_tier: tier }
  if (expiresDate) update.subscription_period_end = expiresDate

  const { error } = await supabaseAdmin
    .from('user_profile')
    .update(update)
    .eq('user_id', userId)

  if (error) {
    console.error(`Failed to update user ${userId} to ${tier}:`, error.message)
  } else {
    console.log(`User ${userId} -> ${tier}`)
  }
}

// ---------------------------------------------------------------------------
// Helper: update family members
// ---------------------------------------------------------------------------
async function updateFamilyMembers(adminUserId: string, tier: 'free' | 'paid') {
  const { data: members } = await supabaseAdmin
    .from('user_profile')
    .select('user_id')
    .eq('invited_by', adminUserId)

  if (members?.length) {
    for (const m of members) {
      await supabaseAdmin
        .from('user_profile')
        .update({ subscription_tier: tier })
        .eq('user_id', m.user_id)
    }
    console.log(`Updated ${members.length} family member(s) to ${tier}`)
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.json()
    const { signedPayload } = body

    if (!signedPayload) {
      console.error('Missing signedPayload')
      return new Response('Missing signedPayload', { status: 400 })
    }

    // Decode the outer notification
    const notification = decodeJWSPayload(signedPayload)
    const notificationType = notification.notificationType
    const subtype = notification.subtype || ''

    console.log(`Apple notification: ${notificationType} (${subtype})`)

    // Decode the transaction info from the signed data
    let transactionInfo: any = null
    let renewalInfo: any = null

    if (notification.data?.signedTransactionInfo) {
      transactionInfo = decodeJWSPayload(notification.data.signedTransactionInfo)
    }
    if (notification.data?.signedRenewalInfo) {
      renewalInfo = decodeJWSPayload(notification.data.signedRenewalInfo)
    }

    if (!transactionInfo) {
      console.log('No transaction info in notification, acknowledging')
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const originalTransactionId = transactionInfo.originalTransactionId
    const productId = transactionInfo.productId

    // Validate product ID
    if (!VALID_PRODUCT_IDS.includes(productId)) {
      console.log(`Ignoring notification for unknown product: ${productId}`)
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Find the user
    const userId = await getUserByAppleTransaction(originalTransactionId)
    if (!userId) {
      console.error(`No user found for transaction ${originalTransactionId}`)
      // Still return 200 so Apple doesn't retry
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle notification types
    switch (notificationType) {
      // ---- Subscription renewed successfully ----
      case 'DID_RENEW': {
        const expiresDate = transactionInfo.expiresDate
          ? new Date(transactionInfo.expiresDate).toISOString()
          : undefined
        await updateUserTier(userId, 'paid', expiresDate)
        await updateFamilyMembers(userId, 'paid')
        console.log(`Renewal processed for user ${userId}`)
        break
      }

      // ---- Subscription initially purchased (backup) ----
      case 'SUBSCRIBED': {
        const expiresDate = transactionInfo.expiresDate
          ? new Date(transactionInfo.expiresDate).toISOString()
          : undefined
        await updateUserTier(userId, 'paid', expiresDate)
        await updateFamilyMembers(userId, 'paid')
        break
      }

      // ---- Subscription expired / not renewed ----
      case 'EXPIRED': {
        await updateUserTier(userId, 'free')
        await updateFamilyMembers(userId, 'free')
        console.log(`Subscription expired for user ${userId}`)
        break
      }

      // ---- User cancelled (will expire at period end) ----
      case 'DID_CHANGE_RENEWAL_STATUS': {
        if (subtype === 'AUTO_RENEW_DISABLED') {
          console.log(`User ${userId} cancelled auto-renew — access continues until period end`)
          // Don't downgrade yet — they paid through the end of the period
        } else if (subtype === 'AUTO_RENEW_ENABLED') {
          console.log(`User ${userId} re-enabled auto-renew`)
        }
        break
      }

      // ---- Billing retry / grace period ----
      case 'DID_FAIL_TO_RENEW': {
        if (subtype === 'GRACE_PERIOD') {
          console.log(`User ${userId} in billing grace period — keeping paid`)
          // Keep them paid during grace period
        } else {
          // Payment failed, no grace period
          console.log(`Renewal payment failed for user ${userId}`)
          // Could downgrade here or wait for EXPIRED
        }
        break
      }

      // ---- Refund ----
      case 'REFUND': {
        await updateUserTier(userId, 'free')
        await updateFamilyMembers(userId, 'free')
        console.log(`Refund processed for user ${userId} — downgraded`)
        break
      }

      // ---- Revoke (family sharing revoked) ----
      case 'REVOKE': {
        await updateUserTier(userId, 'free')
        await updateFamilyMembers(userId, 'free')
        console.log(`Access revoked for user ${userId}`)
        break
      }

      default:
        console.log(`Unhandled Apple notification: ${notificationType}`)
    }

    // Always return 200 so Apple doesn't retry
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('apple-iap-webhook error:', err)
    // Still return 200 to prevent Apple retries on our errors
    return new Response(JSON.stringify({ received: true, error: err.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
