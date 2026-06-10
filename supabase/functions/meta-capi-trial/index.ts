import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// meta-capi-trial
// Fires a Meta 'StartTrial' Conversions API event when a SeniorSafe trial goes
// active, so the ad campaign can attribute + optimize for actual signups.
// Invoked server-side by a Postgres trigger (pg_net) on user_profile; never by
// the browser. Gated by x-proxy-secret == SOCIAL_PROXY_SECRET. Idempotent: it
// stamps user_profile.meta_trial_event_sent_at so it can only fire once/user.
// 2026-05-29.
// ---------------------------------------------------------------------------

const META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') ?? '1237498758330884'
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? 'v20.0'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Meta wants the click id as fbc: fb.1.<unix_ms>.<fbclid>. We stored raw
// fbclid + an ISO captured_at; reconstruct from those.
function buildFbc(src: Record<string, unknown> | null): string | null {
  if (!src || !src.fbclid) return null
  let ms = Date.now()
  if (typeof src.captured_at === 'string') {
    const t = Date.parse(src.captured_at)
    if (!Number.isNaN(t)) ms = t
  }
  return `fb.1.${ms}.${src.fbclid}`
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = Deno.env.get('SOCIAL_PROXY_SECRET') || Deno.env.get('social_proxy_secret') || ''
  const provided = req.headers.get('x-proxy-secret') || ''
  if (!secret || !provided || !safeEqual(provided, secret)) return json({ error: 'Unauthorized' }, 401)

  let body: { user_id?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const userId = body.user_id
  if (!userId) return json({ error: 'user_id required' }, 400)

  const accessToken = Deno.env.get('META_CAPI_ACCESS_TOKEN')
  if (!accessToken) return json({ error: 'META_CAPI_ACCESS_TOKEN not set' }, 500)

  // Load profile; bail if already fired (idempotent guard).
  const { data: profile } = await supabaseAdmin
    .from('user_profile')
    .select('user_id, first_name, last_name, signup_source, meta_trial_event_sent_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (!profile) return json({ ok: false, error: 'profile not found' }, 404)
  if (profile.meta_trial_event_sent_at) return json({ ok: true, skipped: 'already sent' })

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const email = authUser?.user?.email ?? null

  const src = (profile.signup_source ?? null) as Record<string, unknown> | null
  const fbc = buildFbc(src)

  const userData: Record<string, string> = {}
  if (email) userData.em = await sha256Hex(email)
  if (profile.first_name) userData.fn = await sha256Hex(String(profile.first_name))
  if (profile.last_name) userData.ln = await sha256Hex(String(profile.last_name))
  userData.external_id = await sha256Hex(userId)
  if (fbc) userData.fbc = fbc

  const payload = {
    data: [
      {
        event_name: 'StartTrial',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `trial_${userId}`,
        event_source_url: 'https://app.seniorsafeapp.com',
        action_source: 'website',
        user_data: userData,
        custom_data: {
          currency: 'USD',
          value: 0,
          content_name: 'seniorsafe_trial',
          ...(src?.utm_campaign ? { utm_campaign: String(src.utm_campaign) } : {}),
        },
      },
    ],
  }

  let metaOk = false
  let metaResp: unknown = null
  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_PIXEL_ID}/events?access_token=${accessToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) },
    )
    metaResp = await res.json().catch(() => ({}))
    metaOk = res.ok
  } catch (err) {
    metaResp = { error: err instanceof Error ? err.message : 'unknown' }
  }

  // Stamp the guard regardless, so a flaky Meta call never causes duplicate
  // fires on the next trigger. (Meta also dedupes on event_id.)
  await supabaseAdmin
    .from('user_profile')
    .update({ meta_trial_event_sent_at: new Date().toISOString() })
    .eq('user_id', userId)

  return json({ ok: metaOk, had_fbc: !!fbc, meta: metaResp })
})
