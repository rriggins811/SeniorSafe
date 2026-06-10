import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Verify Apple IAP Purchase
// Called by the iOS app after a successful purchase to validate the receipt
// and update the user's subscription status.
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'capacitor://localhost',
  'http://localhost',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

// Apple verification endpoints
const APPLE_PRODUCTION_URL = 'https://buy.itunes.apple.com/verifyReceipt'
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt'

// Our product ID
const VALID_PRODUCT_IDS = [
  'com.rigginsstrategicsolutions.seniorsafe.monthly',
]

// Service-role client for updating user profiles
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ---------------------------------------------------------------------------
// Helper: verify receipt with Apple
// ---------------------------------------------------------------------------
async function verifyWithApple(receiptData: string, useSandbox = false): Promise<any> {
  const url = useSandbox ? APPLE_SANDBOX_URL : APPLE_PRODUCTION_URL
  const appSharedSecret = Deno.env.get('APPLE_SHARED_SECRET') || ''

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'receipt-data': receiptData,
      'password': appSharedSecret,
      'exclude-old-transactions': true,
    }),
  })

  return await response.json()
}

// ---------------------------------------------------------------------------
// Helper: update user subscription
// ---------------------------------------------------------------------------
async function updateUserAppleSubscription(
  userId: string,
  tier: 'free' | 'paid',
  originalTransactionId?: string,
  productId?: string,
  expiresDate?: string,
) {
  const update: Record<string, unknown> = {
    subscription_tier: tier,
    subscription_platform: 'apple',
  }
  if (originalTransactionId) update.apple_original_transaction_id = originalTransactionId
  if (productId) update.apple_product_id = productId
  if (expiresDate) update.subscription_period_end = expiresDate

  const { error, data } = await supabaseAdmin
    .from('user_profile')
    .update(update)
    .eq('user_id', userId)
    .select('user_id, subscription_tier')

  if (error) {
    console.error(`Failed to update user ${userId}:`, error.message)
  } else {
    console.log(`User ${userId} -> subscription_tier = '${data?.[0]?.subscription_tier}'`)
  }
  return error
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    // ---- Auth: get the logged-in user ----
    const authHeader = req.headers.get('Authorization') || ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ---- Parse body ----
    const { receiptData, transactionId, productId } = await req.json()

    if (!receiptData) {
      return new Response(JSON.stringify({ error: 'Missing receiptData' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ---- Verify with Apple (try production first, fall back to sandbox) ----
    let appleResponse = await verifyWithApple(receiptData, false)

    // Status 21007 means receipt is from sandbox — retry against sandbox
    if (appleResponse.status === 21007) {
      console.log('Receipt is sandbox, retrying with sandbox URL')
      appleResponse = await verifyWithApple(receiptData, true)
    }

    if (appleResponse.status !== 0) {
      console.error('Apple verification failed, status:', appleResponse.status)
      return new Response(JSON.stringify({
        error: 'Receipt verification failed',
        apple_status: appleResponse.status
      }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ---- Find the latest active subscription in the receipt ----
    const latestReceipt = appleResponse.latest_receipt_info
    if (!latestReceipt || latestReceipt.length === 0) {
      return new Response(JSON.stringify({ error: 'No subscription found in receipt' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Get the most recent transaction
    const latest = latestReceipt.sort(
      (a: any, b: any) => Number(b.purchase_date_ms) - Number(a.purchase_date_ms)
    )[0]

    // Validate product ID
    if (!VALID_PRODUCT_IDS.includes(latest.product_id)) {
      console.error('Unknown product ID:', latest.product_id)
      return new Response(JSON.stringify({ error: 'Invalid product' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Check if subscription is active (expires_date is in the future)
    const expiresMs = Number(latest.expires_date_ms)
    const isActive = expiresMs > Date.now()

    if (isActive) {
      const expiresDate = new Date(expiresMs).toISOString()
      await updateUserAppleSubscription(
        user.id,
        'paid',
        latest.original_transaction_id,
        latest.product_id,
        expiresDate,
      )

      // Also upgrade family members
      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', user.id)

      if (members?.length) {
        for (const m of members) {
          await supabaseAdmin
            .from('user_profile')
            .update({ subscription_tier: 'paid' })
            .eq('user_id', m.user_id)
        }
        console.log(`Updated ${members.length} family member(s) to paid`)
      }

      return new Response(JSON.stringify({
        valid: true,
        tier: 'paid',
        expires: expiresDate,
        productId: latest.product_id,
      }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } else {
      // Subscription expired
      await updateUserAppleSubscription(user.id, 'free', latest.original_transaction_id, latest.product_id)

      return new Response(JSON.stringify({
        valid: false,
        tier: 'free',
        message: 'Subscription expired',
      }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

  } catch (err) {
    console.error('verify-apple-purchase error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
