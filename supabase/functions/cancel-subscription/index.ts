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
    'Content-Type': 'application/json',
  }
}

// ---------------------------------------------------------------------------
// Cancel subscription at end of billing period
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!

    // ---- Auth ----
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // ---- Get profile ----
    const { data: profile } = await supabase
      .from('user_profile')
      .select('stripe_subscription_id')
      .eq('user_id', user.id)
      .single()

    if (!profile?.stripe_subscription_id) {
      return new Response(
        JSON.stringify({ error: 'No active subscription found' }),
        { status: 400, headers: cors }
      )
    }

    // ---- Cancel at period end (not immediately) ----
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
    const subscription = await stripe.subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: true,
    })

    // Store the end date so the UI can show it
    const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()
    await supabase
      .from('user_profile')
      .update({ subscription_period_end: periodEnd })
      .eq('user_id', user.id)

    console.log(`✅ Subscription ${profile.stripe_subscription_id} set to cancel at ${periodEnd}`)

    return new Response(
      JSON.stringify({ success: true, cancel_at: periodEnd }),
      { status: 200, headers: cors }
    )
  } catch (err) {
    console.error('cancel-subscription error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors })
  }
})
