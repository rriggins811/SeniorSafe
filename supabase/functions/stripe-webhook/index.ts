import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno"

// ---------------------------------------------------------------------------
// Stripe webhook handler
// Listens for checkout completion, subscription updates, and cancellations.
// Updates user_profile.subscription_tier accordingly.
// ---------------------------------------------------------------------------

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

// Service-role client - bypasses RLS so we can update any user's profile
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

type Tier = 'free' | 'paid' | 'premium_plus'

const PRICE_TO_TIER: Record<string, Tier> = {
  'price_1T99bMFoeumweL6DaOZyam4h': 'paid',
  'price_1T99e4FoeumweL6DuVorGKRY': 'paid',
  'price_1TUSe3FoeumweL6DtmuRCVpD': 'premium_plus',
  'price_1TUSeoFoeumweL6DluScBwCU': 'premium_plus',
}

function resolveTier(metadataTier: string | undefined, fallbackPriceId?: string): Tier {
  if (metadataTier === 'premium_plus') return 'premium_plus'
  if (metadataTier === 'premium') return 'paid'
  if (fallbackPriceId && PRICE_TO_TIER[fallbackPriceId]) return PRICE_TO_TIER[fallbackPriceId]
  return 'paid'
}

// ---------------------------------------------------------------------------
// GHL contact + tag via the ghl-proxy Edge Function
// ---------------------------------------------------------------------------
// All GHL writes go through ghl-proxy, which holds GHL_PIT_TOKEN. As of the
// 2026-05-29 security audit the proxy authenticates callers by the service-
// role key (it was previously an open relay accepting the anon key), so this
// same-project call now sends SUPABASE_SERVICE_ROLE_KEY.
const GHL_PROXY_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl-proxy`

async function ghlProxyUpsertAndTag(
  subscriber: {
    email: string
    firstName?: string | null
    lastName?: string | null
    phone?: string | null
  },
  tag: string,
  source: string,
  label: string,
): Promise<void> {
  // Authenticate to ghl-proxy with the service-role key (2026-05-29 audit:
  // the proxy now rejects the public anon key to stop being an open relay).
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!svcKey) {
    console.warn(`[ghl-proxy ${label}] skipped, SUPABASE_SERVICE_ROLE_KEY not set`)
    return
  }
  try {
    const body: Record<string, unknown> = {
      email: subscriber.email,
      tags: [tag],
      source,
    }
    if (subscriber.firstName) body.firstName = subscriber.firstName
    if (subscriber.lastName) body.lastName = subscriber.lastName
    if (subscriber.phone) body.phone = subscriber.phone

    const res = await fetch(GHL_PROXY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${svcKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'post',
        path: '/contacts/upsert',
        body,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    type ProxyEnvelope = { status: number; body: unknown } | { error: string }
    const payload = (await res.json().catch(() => ({}))) as ProxyEnvelope

    if (!res.ok || 'error' in payload) {
      const err = 'error' in payload ? payload.error : `proxy http ${res.status}`
      console.warn(`[ghl-proxy ${label}] ${err}`)
      return
    }
    const ghlOk = payload.status >= 200 && payload.status < 300
    if (!ghlOk) {
      console.warn(`[ghl-proxy ${label}] ghl http ${payload.status}`)
      return
    }
    const contactId =
      (payload.body as { contact?: { id?: string } } | null)?.contact?.id
    console.log(
      `[ghl-proxy ${label}] OK contactId=${contactId ?? '?'} tag=${tag}`,
    )
  } catch (err) {
    console.warn(
      `[ghl-proxy ${label}] failed: ${err instanceof Error ? err.message : 'unknown'}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Meta Conversions API (CAPI) - SeniorSafe Purchase fire
// ---------------------------------------------------------------------------
const META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') ?? '1237498758330884'
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? 'v20.0'

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function fireMetaPurchase(params: {
  tier: 'paid' | 'premium_plus'
  email: string | null
  firstName: string | null
  lastName: string | null
  userId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripeSessionId: string
  amountTotalCents: number | null
  currency: string | null
}): Promise<void> {
  const accessToken = Deno.env.get('META_CAPI_ACCESS_TOKEN')
  if (!accessToken || /PLACEHOLDER/i.test(accessToken)) {
    console.warn('[meta-capi Purchase] skipped, META_CAPI_ACCESS_TOKEN not set')
    return
  }

  const contentName =
    params.tier === 'premium_plus'
      ? 'seniorsafe_premium_plus'
      : 'seniorsafe_premium'

  const value =
    typeof params.amountTotalCents === 'number'
      ? params.amountTotalCents / 100
      : 0
  const currency = (params.currency ?? 'usd').toUpperCase()

  const userData: Record<string, string> = {}
  if (params.email) userData.em = await sha256Hex(params.email)
  if (params.firstName) userData.fn = await sha256Hex(params.firstName)
  if (params.lastName) userData.ln = await sha256Hex(params.lastName)
  userData.external_id = await sha256Hex(params.userId)

  const eventId = `stripe_${params.stripeSessionId}_${Date.now()}`

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        event_source_url: 'https://app.seniorsafeapp.com/upgrade',
        action_source: 'system_generated',
        user_data: userData,
        custom_data: {
          value,
          currency,
          content_name: contentName,
          transaction_id: params.stripeSessionId,
          ...(params.stripeSubscriptionId
            ? { subscription_id: params.stripeSubscriptionId }
            : {}),
        },
      },
    ],
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_PIXEL_ID}/events?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(
        `[meta-capi Purchase] ${res.status} ${res.statusText} ${text.slice(0, 300)}`,
      )
    } else {
      console.log(
        `[meta-capi Purchase] OK content_name=${contentName} value=${value}`,
      )
    }
  } catch (err) {
    console.warn(
      `[meta-capi Purchase] failed: ${err instanceof Error ? err.message : 'unknown'}`,
    )
  }
}

async function lookupSubscriberFields(userId: string): Promise<{
  email: string | null
  firstName: string | null
  lastName: string | null
}> {
  const [{ data: authUser }, { data: profile }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from('user_profile')
      .select('first_name, last_name')
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  return {
    email: authUser?.user?.email ?? null,
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
  }
}

// Stripe API versions from 2025-03-31 (Basil) onward moved current_period_end
// off the Subscription object and onto each subscription item. Our endpoint is
// on 2025-09-30, so webhook payloads use the new shape while SDK calls pinned
// to 2023-10-16 still use the old one. Read whichever is present.
function periodEndOf(sub: { current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> } } | null | undefined): string | undefined {
  const ts = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end
  return typeof ts === 'number' ? new Date(ts * 1000).toISOString() : undefined
}

// ---------------------------------------------------------------------------
// Helper: update a user's tier + Stripe IDs + billing info
// ---------------------------------------------------------------------------
async function updateUserTier(
  userId: string,
  tier: Tier,
  stripeCustomerId?: string,
  stripeSubscriptionId?: string,
  periodEnd?: string,
  interval?: string,
) {
  const update: Record<string, unknown> = { subscription_tier: tier }
  if (tier === 'paid' || tier === 'premium_plus') update.trial_status = 'converted'
  if (stripeCustomerId) update.stripe_customer_id = stripeCustomerId
  if (stripeSubscriptionId) update.stripe_subscription_id = stripeSubscriptionId
  if (periodEnd !== undefined) update.subscription_period_end = periodEnd
  if (interval !== undefined) update.subscription_interval = interval

  const { error, data } = await supabaseAdmin
    .from('user_profile')
    .update(update)
    .eq('user_id', userId)
    .select('user_id, subscription_tier')

  if (error) {
    console.error(`Failed to update user ${userId} to ${tier}:`, error.message)
  } else if (!data || data.length === 0) {
    console.error(`Update returned no rows for user_id ${userId}`)
  } else {
    console.log(`User ${userId} -> subscription_tier = '${data[0]?.subscription_tier}'`)
  }
  return error
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

async function sendTwilioSMS(to: string, message: string) {
  const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
  const AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')
  const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    console.error('Twilio credentials not configured')
    return false
  }

  const credentials = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)
  const body = new URLSearchParams({ To: to, From: FROM_NUMBER, Body: message })

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }
  )
  return response.ok
}

async function getUserIdByStripeCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('user_profile')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (error || !data) {
    console.error('Could not find user for Stripe customer', customerId, error?.message)
    return null
  }
  return data.user_id
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    console.error('Missing stripe-signature header')
    return new Response('Missing signature', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log(`Stripe event: ${event.type} (${event.id})`)

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session

      const userId = session.client_reference_id
      const customerId = session.customer as string
      const subscriptionId = session.subscription as string

      if (!userId) {
        console.error('checkout.session.completed missing client_reference_id')
        break
      }

      let periodEnd: string | undefined
      let interval: string | undefined
      let firstPriceId: string | undefined
      if (subscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId)
          periodEnd = periodEndOf(sub)
          interval = sub.items?.data?.[0]?.price?.recurring?.interval || undefined
          firstPriceId = sub.items?.data?.[0]?.price?.id || undefined
        } catch (subErr) {
          console.error('Could not fetch subscription details:', subErr.message)
        }
      }

      const tier = resolveTier(session.metadata?.tier, firstPriceId)

      await updateUserTier(userId, tier, customerId, subscriptionId, periodEnd, interval)

      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, tier)
        }
        console.log(`Updated ${members.length} family member(s) to ${tier}`)
      }

      const fields = await lookupSubscriberFields(userId)

      if (fields.email && (tier === 'paid' || tier === 'premium_plus')) {
        await ghlProxyUpsertAndTag(
          {
            email: fields.email,
            firstName: fields.firstName,
            lastName: fields.lastName,
          },
          'seniorsafe-paid',
          `seniorsafe_${tier}_purchase`,
          `seniorsafe-${tier}`,
        )
      }

      if (tier === 'paid' || tier === 'premium_plus') {
        await fireMetaPurchase({
          tier,
          email: fields.email,
          firstName: fields.firstName,
          lastName: fields.lastName,
          userId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripeSessionId: session.id,
          amountTotalCents: session.amount_total ?? null,
          currency: session.currency ?? null,
        })
      }

      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      const status = subscription.status

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      if (status === 'active' || status === 'trialing') {
        const periodEnd = periodEndOf(subscription)
        const interval = subscription.items?.data?.[0]?.price?.recurring?.interval || undefined
        const firstPriceId = subscription.items?.data?.[0]?.price?.id || undefined
        const tier = resolveTier(subscription.metadata?.tier, firstPriceId)
        await updateUserTier(userId, tier, customerId, subscription.id, periodEnd, interval)

        const { data: members } = await supabaseAdmin
          .from('user_profile')
          .select('user_id')
          .eq('invited_by', userId)
        if (members?.length) {
          for (const m of members) {
            await updateUserTier(m.user_id, tier)
          }
          console.log(`Cascaded tier ${tier} to ${members.length} family member(s)`)
        }
      } else if (status === 'past_due' || status === 'unpaid') {
        console.log(`Subscription ${subscription.id} is ${status} - keeping paid for now`)
      } else {
        await updateUserTier(userId, 'free', customerId, subscription.id)

        const { data: members } = await supabaseAdmin
          .from('user_profile')
          .select('user_id')
          .eq('invited_by', userId)

        if (members?.length) {
          for (const m of members) {
            await updateUserTier(m.user_id, 'free')
          }
          console.log(`Downgraded ${members.length} family member(s) to free`)
        }
      }

      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      const fields = await lookupSubscriberFields(userId)
      const { data: priorProfile } = await supabaseAdmin
        .from('user_profile')
        .select('subscription_tier')
        .eq('user_id', userId)
        .maybeSingle()
      const priorTier = priorProfile?.subscription_tier ?? null

      await updateUserTier(userId, 'free', customerId, subscription.id)

      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, 'free')
        }
        console.log(`Downgraded ${members.length} family member(s) to free`)
      }

      if (fields.email) {
        await ghlProxyUpsertAndTag(
          {
            email: fields.email,
            firstName: fields.firstName,
            lastName: fields.lastName,
          },
          'seniorsafe-churned',
          'seniorsafe_churn',
          'churn',
        )
      }
      void priorTier

      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      console.log(`Payment failed for customer ${customerId} - attempt: ${invoice.attempt_count}`)

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      await updateUserTier(userId, 'free', customerId)

      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, 'free')
        }
        console.log(`Downgraded ${members.length} family member(s) to free`)
      }

      const { data: adminProfile } = await supabaseAdmin
        .from('user_profile')
        .select('phone, senior_name, first_name')
        .eq('user_id', userId)
        .single()

      if (adminProfile?.phone) {
        const toPhone = normalizePhone(adminProfile.phone)
        const name = adminProfile.senior_name || adminProfile.first_name || 'Your'
        const sent = await sendTwilioSMS(
          toPhone,
          `Your SeniorSafe payment could not be processed. ${name}'s Premium features are paused. Update payment at app.seniorsafeapp.com/upgrade. SeniorSafe. Reply STOP to opt out`
        )
        if (sent) {
          console.log(`Payment failure SMS sent to ${toPhone}`)
        }
      }

      break
    }

    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
