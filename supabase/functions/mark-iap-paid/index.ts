import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// mark-iap-paid
// Called by the iOS/Android app immediately after RevenueCat confirms a purchase.
// RevenueCat already verified the receipt with Apple/Google, so we trust the
// authenticated user's claim and upgrade them via service-role.
//
// Accepts optional `platform` field ('apple' or 'google') to store purchase
// metadata in the correct platform-specific columns.
//
// Build 27: branches subscription_tier on productId. Premium+ products
// (com.rigginsstrategicsolutions.seniorsafe.premiumplus.*) set tier to
// 'premium_plus'; everything else sets tier to 'paid' (Premium-equivalent).
// Family members of an admin inherit the admin's tier.
// ---------------------------------------------------------------------------

// Premium+ product IDs across platforms. Any productId in this list maps to
// subscription_tier='premium_plus'; otherwise 'paid'.
const PREMIUM_PLUS_PRODUCT_IDS = new Set<string>([
  'com.rigginsstrategicsolutions.seniorsafe.premiumplus.monthly',
])

function tierForProductId(productId: string | null): 'premium_plus' | 'paid' {
  return productId && PREMIUM_PLUS_PRODUCT_IDS.has(productId) ? 'premium_plus' : 'paid'
}

const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    // ---- Auth: get the logged-in user from JWT ----
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) {
      console.error('Auth failed:', authErr?.message)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ---- Optional body fields from RevenueCat customerInfo ----
    let originalTransactionId: string | null = null
    let productId: string | null = null
    let expiresDate: string | null = null
    let adminUserId: string | null = null
    let platform: string = 'apple'  // default to apple for backward compatibility

    try {
      const body = await req.json()
      originalTransactionId = body.originalTransactionId || null
      productId = body.productId || null
      expiresDate = body.expiresDate || null
      adminUserId = body.adminUserId || null  // for family-member upgrades targeting admin
      platform = body.platform || 'apple'     // 'apple' or 'google'
    } catch (_) {
      // Body is optional — proceed with just auth
    }

    // The user we upgrade is either the admin (if member is paying) or self
    const targetUserId = adminUserId || user.id

    // ---- Build update payload ----
    // Build 27: branch tier on productId. A Premium+ purchase MUST set
    // subscription_tier='premium_plus' so MaggiePage's gate
    // (effectiveTier === 'premium_plus') unlocks Maggie.
    const tier = tierForProductId(productId)
    const update: Record<string, unknown> = {
      subscription_tier: tier,
      subscription_source: 'revenuecat',
      subscription_platform: platform,
    }

    // Store transaction metadata in platform-specific columns
    if (platform === 'google') {
      if (originalTransactionId) update.google_original_transaction_id = originalTransactionId
      if (productId) update.google_product_id = productId
    } else {
      if (originalTransactionId) update.apple_original_transaction_id = originalTransactionId
      if (productId) update.apple_product_id = productId
    }

    if (expiresDate) update.subscription_period_end = expiresDate

    // ---- Update via service role (bypasses protect_user_profile_columns trigger) ----
    const { data, error: updateErr } = await supabaseAdmin
      .from('user_profile')
      .update(update)
      .eq('user_id', targetUserId)
      .select('user_id, subscription_tier, subscription_platform')

    if (updateErr) {
      console.error(`Failed to upgrade user ${targetUserId}:`, updateErr.message)
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    console.log(`User ${targetUserId} upgraded to ${tier} via ${platform} IAP (productId=${productId || 'unknown'}, caller ${user.id})`)

    // ---- Also upgrade family members ----
    // Family members inherit the admin's tier. A Premium+ admin's family
    // members get 'premium_plus' too (so they can use Maggie under the
    // family subscription).
    const { data: members } = await supabaseAdmin
      .from('user_profile')
      .select('user_id')
      .eq('invited_by', targetUserId)

    if (members?.length) {
      for (const m of members) {
        await supabaseAdmin
          .from('user_profile')
          .update({ subscription_tier: tier })
          .eq('user_id', m.user_id)
      }
      console.log(`Upgraded ${members.length} family member(s) to ${tier} for ${targetUserId}`)
    }

    return new Response(JSON.stringify({
      success: true,
      user: data?.[0],
      familyMembersUpgraded: members?.length || 0,
    }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('mark-iap-paid error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
