import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Send Push Notification via APNs (iOS) or FCM (Android)
// Called internally by other edge functions or cron jobs.
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = [
  'https://app.hammock365.com',
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
// Why the last push failed, for notification_log (2026-09-09: 'failed' alone hid a config error for months).
let lastPushError = ''

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
      console.error(`APNs error for ${deviceToken.slice(0, 12)}...:`, res.status, err)
      lastPushError = `APNs ${res.status} ${(err as { reason?: string })?.reason || ''}`.trim()
      return false
    }
    return true
  } catch (err) {
    console.error('APNs send error:', (err as Error).message)
    lastPushError = `APNs error: ${(err as Error).message}`
    return false
  }
}

// FCM HTTP v1. The legacy fcm/send endpoint (server key) was shut down by
// Google in 2024, which is why Android pushes silently failed. This signs a
// short-lived OAuth token from the Firebase service account JSON held in the
// FCM_SERVICE_ACCOUNT_JSON secret (Firebase console > Project settings >
// Service accounts > Generate new private key).
let cachedFcmToken: { token: string; expiry: number } | null = null

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function b64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getFcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedFcmToken && cachedFcmToken.expiry > now + 60) return cachedFcmToken.token
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`))
  const assertion = `${header}.${claims}.${b64url(sig)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  cachedFcmToken = { token: json.access_token, expiry: now + (json.expires_in || 3600) }
  return cachedFcmToken.token
}

async function sendFcmPush(
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<boolean> {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
  if (!raw) {
    console.error('FCM_SERVICE_ACCOUNT_JSON not configured; Android push skipped')
    return false
  }
  try {
    const sa = JSON.parse(raw)
    const accessToken = await getFcmAccessToken(sa)
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
          android: { priority: 'high', notification: { sound: 'default', channel_id: 'seniorsafe' } },
        },
      }),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error(`FCM v1 error for ${deviceToken.slice(0, 12)}...:`, res.status, err.slice(0, 300))
      lastPushError = `FCM ${res.status} ${err.slice(0, 120)}`
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
    // AUTH (security audit #8): this endpoint had NO auth  -  anyone who knew the URL
    // could push (and SMS-fallback) to any user by id. Require a caller token:
    // service-role (internal callers: family-message-notify, missed-checkin-alerts)
    // may target anyone; a regular logged-in user may target ONLY their own family.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const isInternal = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    let callerRoot: string | null = null
    if (!isInternal) {
      const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { data: cp } = await supabaseAdmin
        .from('user_profile').select('invited_by').eq('user_id', user.id).single()
      callerRoot = cp?.invited_by || user.id
    }

    const { user_ids, title, body, data, notification_type, sms_fallback_message } = await req.json()

    if (!user_ids || !Array.isArray(user_ids) || !title || !body) {
      return new Response(JSON.stringify({ error: 'user_ids (array), title, and body required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: Array<{ user_id: string; push: boolean; sms: boolean; error?: string }> = []

    for (const userId of user_ids) {
      const { data: profile } = await supabaseAdmin
        .from('user_profile')
        .select('device_token, device_platform, phone, family_name, invited_by')
        .eq('user_id', userId)
        .single()

      // A regular caller may only notify members of their OWN family (#8).
      if (!isInternal && (profile?.invited_by || userId) !== callerRoot) {
        results.push({ user_id: userId, push: false, sms: false, error: profile ? 'not in caller family' : 'profile not found' })
        continue
      }

      let pushSent = false
      let smsSent = false
      lastPushError = ''

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
        error_message: pushSent ? null : (lastPushError || (profile?.device_token ? 'Push delivery failed' : 'No device token')),
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

      results.push({ user_id: userId, push: pushSent, sms: smsSent, ...(pushSent ? {} : { error: lastPushError || (profile?.device_token ? 'push failed' : 'no device token') }) })
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