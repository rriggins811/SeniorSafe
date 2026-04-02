import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Send Push Notification via APNs (iOS) or FCM (Android)
// Called internally by other edge functions or cron jobs.
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

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ---------------------------------------------------------------------------
// APNs JWT token generation
// ---------------------------------------------------------------------------
let cachedJwt: { token: string; expiry: number } | null = null

async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  // Reuse token if valid for at least 10 more minutes
  if (cachedJwt && cachedJwt.expiry > now + 600) {
    return cachedJwt.token
  }

  const keyId = Deno.env.get('APNS_KEY_ID')!
  const teamId = Deno.env.get('APNS_TEAM_ID')!
  const privateKeyPem = Deno.env.get('APNS_PRIVATE_KEY')!

  // Parse PEM to raw key bytes
  const pemBody = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const header = { alg: 'ES256', kid: keyId }
  const claims = { iss: teamId, iat: now }

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const unsigned = `${encode(header)}.${encode(claims)}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  )

  // Convert DER signature to raw r||s format expected by JWT
  const sigBytes = new Uint8Array(sig)
  const sigB64 = btoa(String.fromCharCode(...sigBytes))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${unsigned}.${sigB64}`
  cachedJwt = { token: jwt, expiry: now + 3500 } // APNs tokens valid for 1 hour
  return jwt
}

// ---------------------------------------------------------------------------
// Send push to a single device
// ---------------------------------------------------------------------------
async function sendApnsPush(
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<boolean> {
  try {
    const jwt = await getApnsJwt()
    const bundleId = 'com.rigginsstrategicsolutions.seniorsafe'
    const isProduction = Deno.env.get('APNS_PRODUCTION') !== 'false'
    const host = isProduction
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com'

    const payload = {
      aps: {
        alert: { title, body },
        sound: 'default',
        badge: 1,
      },
      ...(data || {}),
    }

    const res = await fetch(`${host}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error(`APNs error for ${deviceToken}:`, res.status, err)
      return false
    }
    return true
  } catch (err) {
    console.error('APNs send error:', (err as Error).message)
    return false
  }
}

async function sendFcmPush(
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<boolean> {
  // FCM via HTTP v1 API (requires service account key)
  const fcmKey = Deno.env.get('FCM_SERVER_KEY')
  if (!fcmKey) {
    console.error('FCM_SERVER_KEY not configured')
    return false
  }

  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Authorization': `key=${fcmKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: deviceToken,
        notification: { title, body, sound: 'default' },
        data: data || {},
      }),
    })

    const result = await res.json()
    if (result.failure > 0) {
      console.error('FCM delivery failed:', result.results)
      return false
    }
    return true
  } catch (err) {
    console.error('FCM send error:', (err as Error).message)
    return false
  }
}

// ---------------------------------------------------------------------------
// SMS fallback helper
// ---------------------------------------------------------------------------
async function sendSmsFallback(phone: string, message: string): Promise<boolean> {
  const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
  const AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
  const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) return false

  const digits = phone.replace(/\D/g, '')
  const toPhone = digits.startsWith('1') ? `+${digits}` : `+1${digits}`

  const credentials = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)
  const body = new URLSearchParams({ To: toPhone, From: FROM_NUMBER, Body: message })

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  )
  return res.ok
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user_ids, title, body, data, notification_type, sms_fallback_message } = await req.json()

    if (!user_ids || !Array.isArray(user_ids) || !title || !body) {
      return new Response(JSON.stringify({ error: 'user_ids (array), title, and body required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: Array<{ user_id: string; push: boolean; sms: boolean }> = []

    for (const userId of user_ids) {
      const { data: profile } = await supabaseAdmin
        .from('user_profile')
        .select('device_token, device_platform, phone, family_name')
        .eq('user_id', userId)
        .single()

      let pushSent = false
      let smsSent = false

      if (profile?.device_token) {
        if (profile.device_platform === 'ios') {
          pushSent = await sendApnsPush(profile.device_token, title, body, data)
        } else if (profile.device_platform === 'android') {
          pushSent = await sendFcmPush(profile.device_token, title, body, data)
        }
      }

      // Log push attempt
      await supabaseAdmin.from('notification_log').insert({
        user_id: userId,
        family_name: profile?.family_name || null,
        notification_type: notification_type || 'system',
        channel: 'push',
        status: pushSent ? 'sent' : 'failed',
        recipient_device_token: profile?.device_token || null,
        error_message: pushSent ? null : 'Push delivery failed or no device token',
      })

      // SMS fallback if push failed and phone available
      if (!pushSent && sms_fallback_message && profile?.phone) {
        smsSent = await sendSmsFallback(profile.phone, sms_fallback_message)

        await supabaseAdmin.from('notification_log').insert({
          user_id: userId,
          family_name: profile?.family_name || null,
          notification_type: notification_type || 'system',
          channel: 'sms',
          status: smsSent ? 'sent' : 'failed',
          recipient_phone: profile.phone,
          error_message: smsSent ? null : 'SMS fallback failed',
        })
      }

      results.push({ user_id: userId, push: pushSent, sms: smsSent })
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
