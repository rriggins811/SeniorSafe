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

// Read price IDs from Supabase secrets, trim whitespace for safety
const PRICE_MAP: Record<string, string> = {
  monthly: (Deno.env.get('STRIPE_PRICE_MONTHLY')?.trim()) || 'price_REPLACE_ME_MONTHLY',
  annual:  (Deno.env.get('STRIPE_PRICE_ANNUAL')?.trim())  || 'price_REPLACE_ME_ANNUAL',
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
    const { plan, admin_user_id } = await req.json() // plan: 'monthly'|'annual', admin_user_id: optional
    const priceId = PRICE_MAP[plan]
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
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
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

    // ---- Determine return URL (use origin of request) ----
    const origin = req.headers.get('Origin') || 'https://app.seniorsafeapp.com'
    const successUrl = `${origin}/dashboard?upgraded=true`
    const cancelUrl = `${origin}/upgrade`

    // ---- Create Stripe Checkout Session ----
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: targetUserId,  // links Stripe session back to admin's Supabase user
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        supabase_user_id: targetUserId,
        paid_by: user.id,
        plan: plan,
      },
    })

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
