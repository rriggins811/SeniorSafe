import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// RevenueCat webhook: the one place App Store and Google Play subscription
// changes land after the purchase itself. Configure it in the RevenueCat
// dashboard (Project > Integrations > Webhooks) with this URL and an
// Authorization header value that matches the REVENUECAT_WEBHOOK_SECRET
// secret. Events: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
//
// Tier rules (2026-09-08, one plan):
//   INITIAL_PURCHASE in a free trial      -> 'trial' (card on file, everything on)
//   INITIAL_PURCHASE paid, RENEWAL,
//   UNCANCELLATION, PRODUCT_CHANGE        -> 'paid'
//   EXPIRATION                            -> 'free'  (the plan-ended banner shows)
//   CANCELLATION                          -> nothing yet; access runs to the end
//   BILLING_ISSUE                         -> one text; the store retries
// The app user id in RevenueCat is the Supabase auth user id.

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type Tier = 'free' | 'paid' | 'trial'

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

async function sendTwilioSMS(to: string, message: string): Promise<boolean> {
  const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
  const AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
  const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) return false
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: FROM_NUMBER, Body: message }).toString(),
  })
  return res.ok
}

async function setTier(userId: string, tier: Tier, extra: Record<string, unknown> = {}) {
  const update: Record<string, unknown> = { subscription_tier: tier, ...extra }
  if (tier === 'paid') update.trial_status = 'converted'
  if (tier === 'trial') update.trial_status = 'active'
  if (tier === 'free') update.trial_status = 'expired'
  const { error } = await supabaseAdmin.from('user_profile').update(update).eq('user_id', userId)
  if (error) console.error(`update ${userId} -> ${tier} failed:`, error.message)
  else console.log(`User ${userId} -> ${tier}`)

  const { data: members } = await supabaseAdmin.from('user_profile').select('user_id').eq('invited_by', userId)
  for (const m of (members || [])) {
    await supabaseAdmin.from('user_profile').update({ subscription_tier: tier }).eq('user_id', m.user_id)
  }
  if (members?.length) console.log(`Cascaded ${tier} to ${members.length} member(s)`)
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!secret || auth !== secret) {
    console.warn('revenuecat-webhook: bad or missing Authorization header')
    return new Response('Unauthorized', { status: 401 })
  }

  let event: Record<string, unknown>
  try {
    const body = await req.json()
    event = (body?.event ?? body) as Record<string, unknown>
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const type = String(event.type || '')
  const userId = String(event.app_user_id || '')
  const periodType = String(event.period_type || '')
  const store = String(event.store || '').toUpperCase()
  const productId = event.product_id ? String(event.product_id) : null
  const expiresMs = typeof event.expiration_at_ms === 'number' ? event.expiration_at_ms : null
  const expires = expiresMs ? new Date(expiresMs).toISOString() : null
  const originalTx = event.original_transaction_id ? String(event.original_transaction_id) : null

  console.log(`RevenueCat event: ${type} user=${userId} period=${periodType} store=${store}`)

  // Ignore RevenueCat's anonymous ids; we only act on real Supabase user ids.
  if (!userId || userId.startsWith('$RCAnonymousID')) {
    return new Response(JSON.stringify({ received: true, ignored: 'anonymous' }), { status: 200 })
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profile').select('user_id, phone, role, invited_by').eq('user_id', userId).maybeSingle()
  if (!profile) {
    console.warn(`no profile for ${userId}`)
    return new Response(JSON.stringify({ received: true, ignored: 'no profile' }), { status: 200 })
  }
  // Store subscriptions belong to the family owner. A member who somehow
  // buys one is treated as buying for the family root.
  const targetId = profile.invited_by || profile.user_id

  const platform = store === 'PLAY_STORE' ? 'google' : 'apple'
  const ids: Record<string, unknown> = { subscription_platform: platform, subscription_source: 'revenuecat' }
  if (platform === 'google') {
    if (originalTx) ids.google_original_transaction_id = originalTx
    if (productId) ids.google_product_id = productId
  } else {
    if (originalTx) ids.apple_original_transaction_id = originalTx
    if (productId) ids.apple_product_id = productId
  }
  if (expires) ids.subscription_period_end = expires

  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'NON_RENEWING_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'TRANSFER':
      await setTier(targetId, periodType === 'TRIAL' ? 'trial' : 'paid', ids)
      break

    case 'EXPIRATION':
      await setTier(targetId, 'free', expires ? { subscription_period_end: expires } : {})
      break

    case 'BILLING_ISSUE': {
      if (profile.phone) {
        const ok = await sendTwilioSMS(
          normalizePhone(profile.phone),
          `SeniorSafeApp could not renew your subscription through ${platform === 'google' ? 'Google Play' : 'the App Store'}. Update your payment method there so the family texts keep going. Reply STOP to opt out`,
        )
        await supabaseAdmin.from('notification_log').insert({
          user_id: targetId, notification_type: 'payment_failed', channel: 'sms', status: ok ? 'sent' : 'failed', recipient_phone: profile.phone,
        })
      }
      break
    }

    case 'CANCELLATION':
    case 'SUBSCRIPTION_PAUSED':
    case 'SUBSCRIBER_ALIAS':
    case 'TEST':
    default:
      console.log(`no tier change for ${type}`)
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
