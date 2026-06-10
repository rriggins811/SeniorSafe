import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// ---------------------------------------------------------------------------
// GHL Social Planner scheduler. Twin of buffer-schedule.
// Holds GHL_PIT_TOKEN + GHL_LOCATION_ID in Supabase function secrets.
// Actions: list_accounts | list_users | schedule_post | edit_post | get_post | delete_post
//
// 2026-05-29 security gate: requires header `x-proxy-secret` to equal the
// SOCIAL_PROXY_SECRET Supabase secret WHEN that secret is configured. Accepts
// either the upper- or lower-case secret name. Until it is set the gate is
// dormant (logs a warning). If this function is rebuilt from Cowork, keep this
// gate block or it reverts to an open relay.
// ---------------------------------------------------------------------------

const BASE = 'https://services.leadconnectorhq.com'
const VER = '2021-07-28'

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function mimeFor(url: string): string {
  const u = url.toLowerCase().split('?')[0]
  if (u.endsWith('.png')) return 'image/png'
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg'
  if (u.endsWith('.gif')) return 'image/gif'
  if (u.endsWith('.mp4')) return 'video/mp4'
  return 'image/jpeg'
}

function buildBody(p: Record<string, any>) {
  const accountIds: string[] = p.account_ids || p.accountIds || []
  const summary: string = p.summary || p.content || ''
  const urls: string[] = ((p.image_urls as string[]) || (p.image_url ? [p.image_url] : []))
    .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
  const status: string = p.status || 'draft'
  const body: Record<string, unknown> = {
    accountIds,
    summary,
    type: p.post_type || 'post',
    status,
    media: urls.map((u) => ({ url: u, type: mimeFor(u) })),
  }
  if (p.user_id) body.userId = p.user_id
  if (status === 'scheduled' && p.schedule_date) body.scheduleDate = p.schedule_date
  if (p.follow_up_comment) body.followUpComment = p.follow_up_comment
  return body
}

async function ghl(method: string, path: string, token: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Version': VER,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  }
  if (body !== undefined && method !== 'GET') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let parsed: unknown
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // ---- Auth gate: enforce when the secret is configured (accept either case) ----
  const proxySecret = Deno.env.get('SOCIAL_PROXY_SECRET') || Deno.env.get('social_proxy_secret') || ''
  if (proxySecret) {
    const provided = req.headers.get('x-proxy-secret') || ''
    if (!provided || !safeEqual(provided, proxySecret)) return json({ error: 'Unauthorized' }, 401)
  } else {
    console.warn('[ghl-social-schedule] SOCIAL_PROXY_SECRET not set — auth gate dormant (open relay)')
  }

  const token = Deno.env.get('GHL_PIT_TOKEN') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!token || !loc) return json({ error: 'GHL_PIT_TOKEN or GHL_LOCATION_ID not configured' }, 500)

  let payload: { action?: string; params?: Record<string, unknown> }
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const action = payload.action
  const p = (payload.params ?? {}) as Record<string, any>

  try {
    if (action === 'list_accounts') {
      const r = await ghl('GET', `/social-media-posting/${loc}/accounts`, token)
      return json(r, 200)
    }

    if (action === 'list_users') {
      const r = await ghl('GET', `/users/?locationId=${loc}`, token)
      return json(r, 200)
    }

    if (action === 'schedule_post') {
      const accountIds: string[] = p.account_ids || p.accountIds || []
      const summary: string = p.summary || p.content || ''
      if (!Array.isArray(accountIds) || accountIds.length === 0) return json({ ok: false, error: 'Missing account_ids' }, 400)
      if (!summary) return json({ ok: false, error: 'Missing summary' }, 400)
      const body = buildBody(p)
      const r = await ghl('POST', `/social-media-posting/${loc}/posts`, token, body)
      const ok = r.status >= 200 && r.status < 300
      return json({ ok, httpStatus: r.status, sent: body, response: r.body }, 200)
    }

    if (action === 'edit_post') {
      const id = p.post_id
      if (!id) return json({ ok: false, error: 'Missing post_id' }, 400)
      const body = buildBody(p)
      const r = await ghl('PUT', `/social-media-posting/${loc}/posts/${id}`, token, body)
      const ok = r.status >= 200 && r.status < 300
      return json({ ok, httpStatus: r.status, sent: body, response: r.body }, 200)
    }

    if (action === 'get_post') {
      const id = p.post_id
      if (!id) return json({ error: 'Missing post_id' }, 400)
      const r = await ghl('GET', `/social-media-posting/${loc}/posts/${id}`, token)
      return json(r, 200)
    }

    if (action === 'delete_post') {
      const id = p.post_id
      if (!id) return json({ error: 'Missing post_id' }, 400)
      const r = await ghl('DELETE', `/social-media-posting/${loc}/posts/${id}`, token)
      return json({ ok: r.status >= 200 && r.status < 300, httpStatus: r.status, response: r.body }, 200)
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'unknown error' }, 500)
  }
})
