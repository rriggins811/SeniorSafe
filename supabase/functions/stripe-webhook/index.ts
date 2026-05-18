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

// Service-role client — bypasses RLS so we can update any user's profile
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ---------------------------------------------------------------------------
// Tier resolution: Stripe-side tier name → user_profile.subscription_tier value
// ---------------------------------------------------------------------------
// 'premium' (the create-checkout body name) maps to 'paid' in user_profile.
// 'premium_plus' maps to 'premium_plus' as-is.
type Tier = 'free' | 'paid' | 'premium_plus'

// Reverse lookup: live Stripe price ID → user_profile.subscription_tier value.
// Used as a fallback for events where metadata.tier is missing (legacy
// subscriptions created before the metadata stamp shipped, or Stripe Customer
// Portal tier switches that don't carry our metadata). Keep in sync with the
// PRICE_MAP in create-checkout/index.ts.
const PRICE_TO_TIER: Record<string, Tier> = {
  // Premium tier ($14.99/mo, $143.88/yr)
  'price_1T99bMFoeumweL6DaOZyam4h': 'paid',
  'price_1T99e4FoeumweL6DuVorGKRY': 'paid',
  // Premium+ tier ($39.99/mo, $383.90/yr)
  'price_1TUSe3FoeumweL6DtmuRCVpD': 'premium_plus',
  'price_1TUSeoFoeumweL6DluScBwCU': 'premium_plus',
}

function resolveTier(metadataTier: string | undefined, fallbackPriceId?: string): Tier {
  if (metadataTier === 'premium_plus') return 'premium_plus'
  if (metadataTier === 'premium') return 'paid'
  // Fallback: look up by price ID for events that lack metadata.tier
  if (fallbackPriceId && PRICE_TO_TIER[fallbackPriceId]) return PRICE_TO_TIER[fallbackPriceId]
  // Conservative default — never accidentally grant Maggie. Caller chose
  // 'paid' as the safest baseline if metadata + price both missing.
  return 'paid'
}

// ---------------------------------------------------------------------------
// Direct Kit (formerly ConvertKit) v4 tag application
// ---------------------------------------------------------------------------
// Replaces the previous Make.com fan-out (scenarios 4994124 / 4994125)
// which exhibited a broken-webhook-resource pattern: every execution
// produced a 40-second ModuleTimeoutError at gateway:CustomWebHook with
// transfer=0 bytes despite the gateway returning 200 to the caller.
// Recreating the hooks (v1 → v2) did not fix it.
//
// Phase 6 (May 18, 2026): Kit retired entirely. All subscriber lifecycle
// tagging now flows through the GHL ghl-proxy Edge Function below. The
// seniorsafe-premium / seniorsafe-premium-plus tagging on checkout is
// already covered by the seniorsafe-paid GHL tag (the locked workflow
// trigger). The seniorsafe-churned signal previously held only in Kit
// (tag 19444482) is now mirrored as a GHL `seniorsafe-churned` tag in
// customer.subscription.deleted below.
//
// KIT_API_KEY env var has been removed from Supabase Edge Function
// secrets. Make scenarios 4994110 / 4994124 / 4994125 remain in
// deactivated state for forensic record-keeping.

// ---------------------------------------------------------------------------
// GHL contact + tag via the ghl-proxy Edge Function (Block C Phase 4, May 15)
// ---------------------------------------------------------------------------
// Per memory/sop_ghl_operations.md (locked May 14), all GHL writes go through
// the ghl-proxy Edge Function — keeps GHL_PIT_TOKEN in Supabase Edge Function
// secrets, off any Vercel env or repo. This is the same proxy the rss-site
// /freeguide route (Phase 1) and blueprint-site Stripe webhook (Phase 3) call.
//
// Same-project Edge Function call so the network hop is internal even though
// we go through the public URL. The whitelist on writes is enforced by the
// proxy: /contacts/upsert + contact-scoped /tags pass through.
//
// Tag taxonomy (locked, do NOT normalize the strings):
//   seniorsafe-paid    — preserved format, paired with workflow trigger
//                        "SeniorSafe-Remove on subscribe" (workflow ID
//                        1373ff1a-...) which cleans the trial-active tag
//                        and exits the Trial Nurture sequence.
//   product-seniorsafe-premium / -plus — SOP marks these as "(future) — once
//                        paid customers grow." Holding off until Ryan signals
//                        — would introduce orphaned tags with no workflow
//                        consumer today.
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!anonKey) {
    console.warn(`[ghl-proxy ${label}] skipped, SUPABASE_ANON_KEY not set`)
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
        'Authorization': `Bearer ${anonKey}`,
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
// Meta Conversions API (CAPI) — SeniorSafe Purchase fire
// ---------------------------------------------------------------------------
// Standard 'Purchase' event fired server-to-server on checkout.session.completed.
// Single shared pixel (id 1237498758330884) across rss-site, blueprint-site,
// and seniorsafeapp.com so Andromeda gets unified signal.
//
// Tier → content_name mapping (per Ryan Q5 confirmation):
//   'paid'         → 'seniorsafe_premium'      ($14.99/mo or $143.88/yr)
//   'premium_plus' → 'seniorsafe_premium_plus' ($39.99/mo or $383.90/yr)
//
// NEVER use 'OrderFormPurchase' — that legacy Squarespace event name is
// blocked Meta-side.
//
// Env: META_PIXEL_ID, META_CAPI_ACCESS_TOKEN, META_GRAPH_API_VERSION
// (all in Supabase Edge Function secrets, NOT Vercel).
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

  // Hash all PII before send. Meta rejects raw email/name in user_data.
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

// Pull email + names for subscriber lifecycle tagging (GHL). Email lives
// on auth.users; first/last live on user_profile. Returns null fields
// rather than throwing if any lookup misses — ghlProxyUpsertAndTag
// tolerates a missing first_name (GHL dedupes contacts by email).
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
    console.error(`❌ Failed to update user ${userId} to ${tier}:`, error.message)
  } else if (!data || data.length === 0) {
    console.error(`❌ Update returned no rows — user_id "${userId}" may not exist in user_profile`)
  } else {
    console.log(`✅ User ${userId} → subscription_tier = '${data[0]?.subscription_tier}'`)
  }
  return error
}

// ---------------------------------------------------------------------------
// Helper: normalize phone number
// ---------------------------------------------------------------------------
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

// ---------------------------------------------------------------------------
// Helper: send SMS via Twilio
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helper: look up Supabase user_id from a Stripe customer ID
// (for events that don't carry client_reference_id)
// ---------------------------------------------------------------------------
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

  // ---- Verify Stripe signature ----
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

  console.log(`📨 Stripe event: ${event.type} (${event.id})`)

  // ---- Handle events ----
  switch (event.type) {

    // ========================================
    // CHECKOUT COMPLETED — user just paid
    // ========================================
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session

      // client_reference_id = Supabase user_id (set in create-checkout)
      const userId = session.client_reference_id
      const customerId = session.customer as string
      const subscriptionId = session.subscription as string

      if (!userId) {
        console.error('checkout.session.completed missing client_reference_id')
        break
      }

      // Fetch subscription details for billing info + price ID fallback
      let periodEnd: string | undefined
      let interval: string | undefined
      let firstPriceId: string | undefined
      if (subscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId)
          periodEnd = new Date(sub.current_period_end * 1000).toISOString()
          interval = sub.items?.data?.[0]?.price?.recurring?.interval || undefined
          firstPriceId = sub.items?.data?.[0]?.price?.id || undefined
        } catch (subErr) {
          console.error('Could not fetch subscription details:', subErr.message)
        }
      }

      // Resolve tier from session metadata (stamped by create-checkout) with
      // price-ID fallback for legacy sessions or future portal-driven tier
      // switches.
      const tier = resolveTier(session.metadata?.tier, firstPriceId)

      await updateUserTier(userId, tier, customerId, subscriptionId, periodEnd, interval)

      // Also update any family members (invited_by this admin) to the same tier
      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, tier)
        }
        console.log(`✅ Updated ${members.length} family member(s) to ${tier}`)
      }

      const fields = await lookupSubscriberFields(userId)

      // GHL contact + tag via ghl-proxy (Block C Phase 4, sole tagging path
      // post-Phase 6). Both 'paid' and 'premium_plus' get the same
      // `seniorsafe-paid` tag — the locked workflow trigger ("SeniorSafe-
      // Remove on subscribe", workflow ID 1373ff1a-...) listens for that
      // exact tag string and handles cleanup of trial-active + exit from
      // Trial Nurture. (Kit `seniorsafe-premium` / `seniorsafe-premium-plus`
      // calls retired May 18 — GHL `seniorsafe-paid` is the system of
      // record for paid-tier lifecycle now.)
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

      // Meta Purchase CAPI fire. Best-effort, never blocks. Standard
      // 'Purchase' event with content_name routing 'paid' →
      // 'seniorsafe_premium', 'premium_plus' → 'seniorsafe_premium_plus'.
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

    // ========================================
    // SUBSCRIPTION UPDATED — plan change, renewal, payment method change
    // ========================================
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      const status = subscription.status

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      // Active or trialing = paid/premium_plus; anything else = free
      if (status === 'active' || status === 'trialing') {
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()
        const interval = subscription.items?.data?.[0]?.price?.recurring?.interval || undefined
        const firstPriceId = subscription.items?.data?.[0]?.price?.id || undefined
        // Resolve tier from subscription metadata (stamped by create-checkout
        // via subscription_data.metadata) with price-ID fallback.
        const tier = resolveTier(subscription.metadata?.tier, firstPriceId)
        await updateUserTier(userId, tier, customerId, subscription.id, periodEnd, interval)

        // Cascade tier changes to family members (e.g. admin uses Stripe
        // Customer Portal to upgrade Premium → Premium+, family follows).
        const { data: members } = await supabaseAdmin
          .from('user_profile')
          .select('user_id')
          .eq('invited_by', userId)
        if (members?.length) {
          for (const m of members) {
            await updateUserTier(m.user_id, tier)
          }
          console.log(`🔁 Cascaded tier ${tier} to ${members.length} family member(s)`)
        }
      } else if (status === 'past_due' || status === 'unpaid') {
        // Give a grace period — don't downgrade immediately on past_due
        // Stripe will retry payment. Only downgrade on explicit cancel/expire.
        console.log(`⚠️ Subscription ${subscription.id} is ${status} — keeping paid for now`)
      } else {
        // canceled, incomplete_expired, etc.
        await updateUserTier(userId, 'free', customerId, subscription.id)

        // Downgrade family members too
        const { data: members } = await supabaseAdmin
          .from('user_profile')
          .select('user_id')
          .eq('invited_by', userId)

        if (members?.length) {
          for (const m of members) {
            await updateUserTier(m.user_id, 'free')
          }
          console.log(`⬇️ Downgraded ${members.length} family member(s) to free`)
        }
      }

      break
    }

    // ========================================
    // SUBSCRIPTION DELETED — cancelled and period ended
    // ========================================
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      // Capture prior tier + subscriber fields BEFORE the updateUserTier
      // flip to free, so the churn signal carries the tier the customer
      // is churning FROM (kept around for future per-tier winback workflows
      // in GHL — currently logged for analytics only).
      const fields = await lookupSubscriberFields(userId)
      const { data: priorProfile } = await supabaseAdmin
        .from('user_profile')
        .select('subscription_tier')
        .eq('user_id', userId)
        .maybeSingle()
      const priorTier = priorProfile?.subscription_tier ?? null

      await updateUserTier(userId, 'free', customerId, subscription.id)

      // Downgrade family members too
      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, 'free')
        }
        console.log(`⬇️ Downgraded ${members.length} family member(s) to free`)
      }

      // Apply seniorsafe-churned tag via ghl-proxy. (Phase 6 — replaces
      // the May-7 Kit `seniorsafe-churned` tag, ID 19444482.) Tag string
      // mirrors the blueprint-site notifyChurn handler, which also fires
      // for this same Stripe customer.subscription.deleted event because
      // the Stripe account is shared between Blueprint and SeniorSafe.
      // Double-tag is safe — GHL contact-tag application is idempotent.
      // prior_tier is captured above for analytics; not passed to GHL
      // because the locked tag taxonomy doesn't yet have per-tier churn
      // tags (single seniorsafe-churned signal is enough today).
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
      // Suppress unused-var warning while we keep priorTier for log/analytics:
      void priorTier

      break
    }

    // ========================================
    // INVOICE PAYMENT FAILED — payment retry failed
    // ========================================
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      console.log(`⚠️ Payment failed for customer ${customerId} — attempt: ${invoice.attempt_count}`)

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      // Flip admin to free tier
      await updateUserTier(userId, 'free', customerId)

      // Downgrade family members too
      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, 'free')
        }
        console.log(`⬇️ Downgraded ${members.length} family member(s) to free`)
      }

      // Send SMS notification to admin about payment failure
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
          `Your SeniorSafe payment could not be processed. ${name}'s Premium features are paused. Update payment at app.seniorsafeapp.com/upgrade — SeniorSafe. Reply STOP to opt out`
        )
        if (sent) {
          console.log(`📱 Payment failure SMS sent to ${toPhone}`)
        }
      }

      break
    }

    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  // Always return 200 so Stripe doesn't retry
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
