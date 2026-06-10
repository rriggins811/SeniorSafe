import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// mark-iap-paid
// Called by the iOS/Android app after RevenueCat confirms a purchase.
//
// SECURITY (2026-05-29 audit hardening):
//  1. adminUserId is no longer blindly trusted. A caller may only upgrade
//     themselves OR the admin who actually invited them (verified via
//     user_profile.invited_by). This closes the arbitrary-account-upgrade
//     hole (previously anyone could pass any adminUserId).
//  2. Optional server-side RevenueCat entitlement verification. When
//     REVENUECAT_SECRET_KEY is set, the claimed entitlement is verified
//     against RevenueCat's API for this app_user_id (= Supabase user id)
//     before any tier change. Until that secret is configured the function
//     keeps its prior trust-the-client behaviour so live purchases are not
//     interrupted; configure the secret to enforce. This is the full fix
//     for the free-upgrade bypass and needs NO app rebuild.
//
// NOTE (2026-06-10 repo sync): this file was re-synced FROM the deployed
// function (version 21). The repo previously held the OLD pre-hardening code
// (targetUserId = adminUserId || user.id, no auth check). Deploying the stale
// repo copy would have RE-OPENED the arbitrary-upgrade hole. Keep repo == prod.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Optional RevenueCat entitlement verification.
// Returns { ok: true } when verification passes OR is not configured.
// Returns { ok: false, reason } when configured AND the claimed tier is not
// backed by an active RevenueCat entitlement for this user.
// ---------------------------------------------------------------------------
async function verifyRevenueCat(
  appUserId: string,
  tier: 'premium_plus' | 'paid',
): Promise<{ ok: boolean; reason?: string }> {
  const rcKey = Deno.env.get('REVENUECAT_SECRET_KEY')
  if (!rcKey) {
    // Not configured yet — preserve prior behaviour, do not block purchases.
    console.warn('[mark-iap-paid] REVENUECAT_SECRET_KEY not set — skipping server-side verification')
    return { ok: true }
  }
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: { 'Authorization': `Bearer ${rcKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!res.ok) {
      // Cannot confirm — fail closed when verification is enabled.
      return { ok: false, reason: `revenuecat lookup ${res.status}` }
    }
    const data = await res.json()
    const active = (data?.subscriber?.entitlements ?? {}) as Record<string, unknown>
    const activeIds = Object.keys(active)
    if (tier === 'premium_plus') {
      // Premium+ claim must be backed by an active premium_plus entitlement.
      if (!('premium_plus' in active)) {
        return { ok: false, reason: 'no active premium_plus entitlement' }
      }
    } else {
      // Paid claim must be backed by at least one active entitlement.
      if (activeIds.length === 0) {
        return { ok: false, reason: 'no active entitlements' }
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `revenuecat error: ${err instanceof Error ? err.message : 'unknown'}` }
  }
}

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
    let platform: string = 'apple'

    try {
      const body = await req.json()
      originalTransactionId = body.originalTransactionId || null
      productId = body.productId || null
      expiresDate = body.expiresDate || null
      adminUserId = body.adminUserId || null
      platform = body.platform || 'apple'
    } catch (_) {
      // Body is optional — proceed with just auth
    }

    // ---- Resolve + AUTHORIZE the upgrade target ----
    // A caller may upgrade themselves, or the admin who invited them. Any
    // other adminUserId is rejected (was previously trusted blindly).
    let targetUserId = user.id
    if (adminUserId && adminUserId !== user.id) {
      const { data: callerProfile } = await supabaseAdmin
        .from('user_profile')
        .select('invited_by')
        .eq('user_id', user.id)
        .single()
      if (!callerProfile || callerProfile.invited_by !== adminUserId) {
        console.warn(`[mark-iap-paid] caller ${user.id} tried to upgrade unrelated admin ${adminUserId}`)
        return new Response(JSON.stringify({ error: 'Forbidden: adminUserId is not your family admin' }), {
          status: 403,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      targetUserId = adminUserId
    }

    const tier = tierForProductId(productId)

    // ---- Verify the entitlement server-side (no-op until secret configured) ----
    const rc = await verifyRevenueCat(user.id, tier)
    if (!rc.ok) {
      console.warn(`[mark-iap-paid] RevenueCat verification failed for ${user.id}: ${rc.reason}`)
      return new Response(JSON.stringify({ error: 'Purchase could not be verified' }), {
        status: 402,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ---- Build update payload ----
    const update: Record<string, unknown> = {
      subscription_tier: tier,
      subscription_source: 'revenuecat',
      subscription_platform: platform,
    }

    if (platform === 'google') {
      if (originalTransactionId) update.google_original_transaction_id = originalTransactionId
      if (productId) update.google_product_id = productId
    } else {
      if (originalTransactionId) update.apple_original_transaction_id = originalTransactionId
      if (productId) update.apple_product_id = productId
    }

    if (expiresDate) update.subscription_period_end = expiresDate

    // ---- Update via service role ----
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

    // ---- Also upgrade family members (admin's invitees inherit the tier) ----
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
