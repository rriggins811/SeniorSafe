import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno"

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'http://localhost:5173',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

// ---------------------------------------------------------------------------
// Stripe + Supabase init
// ---------------------------------------------------------------------------
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

// Price map: tier × plan → live Stripe price ID.
// Env vars win when set, hardcoded live IDs as fallback. Stripe price IDs are
// public identifiers (they ship to the browser in any Checkout flow), so
// baking them into the function source is safe and removes a "you must set
// secrets first" deploy step. To override later, set Supabase function
// secrets STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL / STRIPE_PRICE_PLUS_MONTHLY
// / STRIPE_PRICE_PLUS_ANNUAL.
type Tier = 'premium' | 'premium_plus'
type Plan = 'monthly' | 'annual'

const PRICE_MAP: Record<Tier, Record<Plan, string>> = {
  premium: {
    monthly: (Deno.env.get('STRIPE_PRICE_MONTHLY')?.trim()) || 'price_REPLACE_ME_MONTHLY',
    annual:  (Deno.env.get('STRIPE_PRICE_ANNUAL')?.trim())  || 'price_REPLACE_ME_ANNUAL',
  },
  premium_plus: {
    monthly: (Deno.env.get('STRIPE_PRICE_PLUS_MONTHLY')?.trim()) || 'price_1TUSe3FoeumweL6DtmuRCVpD',
    annual:  (Deno.env.get('STRIPE_PRICE_PLUS_ANNUAL')?.trim())  || 'price_1TUSeoFoeumweL6DluScBwCU',
  },
}

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  // Handle CORS preflight
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
    // ---- Auth: manually verify the JWT using the service-role client ----
    // (verify_jwt is disabled at the gateway for this function so we can
    // return a useful error and avoid stale gateway-cache 401s.)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      console.error('Auth error:', authError)
      return new Response(JSON.stringify({ error: 'Invalid token', details: authError?.message }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    console.log('Authenticated user:', user.id, user.email)

    // ---- Parse body ----
    // tier defaults to 'premium' for backward compat with existing callers
    // that only sent { plan }.
    const body = await req.json()
    const plan: Plan = body.plan
    const tier: Tier = (body.tier as Tier) || 'premium'
    const admin_user_id: string | undefined = body.admin_user_id

    if (tier !== 'premium' && tier !== 'premium_plus') {
      return new Response(JSON.stringify({ error: 'Invalid tier. Use "premium" or "premium_plus".' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const tierMap = PRICE_MAP[tier]
    const priceId = tierMap[plan]
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Invalid plan. Use "monthly" or "annual".' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ---- Determine whose plan to upgrade ----
    let targetUserId = user.id

    if (admin_user_id) {
      // A family member is paying for their admin's plan.
      // Verify the requesting user is actually a member of that admin.
      const { data: memberProfile } = await supabaseAdmin
        .from('user_profile')
        .select('invited_by')
        .eq('user_id', user.id)
        .single()

      if (!memberProfile || memberProfile.invited_by !== admin_user_id) {
        return new Response(JSON.stringify({ error: 'Not authorized to upgrade this account' }), {
          status: 403,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      targetUserId = admin_user_id
      console.log(`👨‍👩‍👧 Member ${user.id} upgrading admin ${admin_user_id}`)
    }

    // ---- Check if user is still in trial (offer Stripe trial if so) ----
    const { data: targetProfile } = await supabaseAdmin
      .from('user_profile')
      .select('trial_status, trial_start_date')
      .eq('user_id', targetUserId)
      .single()

    // Calculate remaining trial days for Stripe trial_period_days
    let trialDays = 0
    if (targetProfile?.trial_status === 'active' && targetProfile?.trial_start_date) {
      const start = new Date(targetProfile.trial_start_date)
      const now = new Date()
      const elapsed = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      trialDays = Math.max(0, 14 - elapsed)
    }

    // ---- Determine return URL (use origin of request) ----
    const origin = req.headers.get('Origin') || 'https://app.seniorsafeapp.com'
    const successUrl = `${origin}/dashboard?upgraded=true`
    const cancelUrl = `${origin}/upgrade`

    // ---- Create Stripe Checkout Session ----
    const sessionParams: Record<string, unknown> = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_email: user.email,
      client_reference_id: targetUserId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        supabase_user_id: targetUserId,
        paid_by: user.id,
        plan: plan,
        tier: tier,
      },
    }

    // If user is still in trial, sync remaining trial days to Stripe
    if (trialDays > 0) {
      sessionParams.subscription_data = { trial_period_days: trialDays }
    }

    const session = await stripe.checkout.sessions.create(sessionParams as any)

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-checkout error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
