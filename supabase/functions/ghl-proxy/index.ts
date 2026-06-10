import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// ---------------------------------------------------------------------------
// GHL (GoHighLevel) API proxy Edge Function
// Holds GHL_PIT_TOKEN + GHL_LOCATION_ID in Supabase function secrets.
// Auth: valid service-role key as bearer (full), or BRIEFING_READONLY_KEY for
// GET + whitelisted POST searches only. Verify JWT OFF (sb_secret != JWT).
//
// 2026-06-05 ADDITIVE TAGGING FIX: GHL's /contacts/upsert REPLACES the
// contact's entire tag set when a `tags` array is sent, silently wiping tags
// other funnels applied (caught on a real Core buyer who lost her product tag
// after a later guide download). At this choke point, when an upsert carries
// tags we strip them, upsert WITHOUT tags, then add them via the
// contact-scoped /contacts/{id}/tags endpoint (which APPENDS). Every proxy
// caller is fixed transparently and the replace behavior cannot be
// reintroduced by a caller.
// ---------------------------------------------------------------------------

const GHL_API_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''

const ALLOWED_WRITES = new Set([
  '/contacts',
  '/contacts/upsert',
  '/contacts/tags',
  '/conversations/messages',
  '/calendars',
  '/opportunities',
])

const READONLY_POST_PATHS = new Set([
  '/contacts/search',
  '/conversations/search',
])

function isAllowedWritePath(path: string): boolean {
  for (const prefix of ALLOWED_WRITES) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      return true
    }
  }
  if (/^\/contacts\/[^/]+\/(tags|notes|workflow)/i.test(path)) return true
  return false
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function isReadonlyCall(action: string, path: string): boolean {
  if (action === 'get') return true
  if (action === 'post' && READONLY_POST_PATHS.has(path.split('?')[0])) return true
  return false
}

async function isServiceRole(bearer: string): Promise<boolean> {
  if (!bearer) return false
  if (safeEqual(bearer, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')) return true
  if (!SUPABASE_URL) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { 'apikey': bearer, 'Authorization': `Bearer ${bearer}` },
      signal: AbortSignal.timeout(8000),
    })
    return r.status === 200
  } catch {
    return false
  }
}

async function ghlFetch(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  token: string,
  body: unknown | undefined,
) {
  const url = `${GHL_API_BASE}${path.startsWith('/') ? path : '/' + path}`
  const init: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Version': GHL_VERSION,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  }
  if (body !== undefined && method !== 'GET') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(url, init)
  let payload: unknown
  const text = await res.text()
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  return { status: res.status, body: payload }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let payload: { action?: string; path?: string; body?: unknown; inject_location?: boolean }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let { action, path, body, inject_location } = payload
  if (!action || !path) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: action, path' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ---- AUTH ----
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const suppliedBriefKey = req.headers.get('X-Briefing-Key') || bearer
  const briefingKey = Deno.env.get('BRIEFING_READONLY_KEY') || ''
  const isBriefingReader = !!briefingKey && safeEqual(suppliedBriefKey, briefingKey) && isReadonlyCall(action, path)
  if (!isBriefingReader && !(await isServiceRole(bearer))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const token = Deno.env.get('GHL_PIT_TOKEN')
  const locationId = Deno.env.get('GHL_LOCATION_ID')
  if (!token || !locationId) {
    return new Response(
      JSON.stringify({ error: 'GHL_PIT_TOKEN or GHL_LOCATION_ID not configured in Supabase Edge Function secrets' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (inject_location !== false) {
    if (action === 'get' && !path.includes('locationId=')) {
      const sep = path.includes('?') ? '&' : '?'
      path = `${path}${sep}locationId=${locationId}`
    }
    if (action === 'post' && body && typeof body === 'object' && !Array.isArray(body)) {
      const obj = body as Record<string, unknown>
      if (!('locationId' in obj)) {
        obj.locationId = locationId
      }
    }
  }

  try {
    let method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    switch (action) {
      case 'get': method = 'GET'; break
      case 'post': method = 'POST'; break
      case 'put': method = 'PUT'; break
      case 'delete': method = 'DELETE'; break
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
    }

    if (method !== 'GET' && !isAllowedWritePath(path.split('?')[0]) && !(isBriefingReader && isReadonlyCall(action, path))) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Write to path '${path}' not whitelisted. Allowed prefixes: ${[...ALLOWED_WRITES].join(', ')} + contact-scoped tag/note/workflow ops.`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // ---- ADDITIVE TAGGING (see header). Intercept upsert-with-tags so the
    // contact's existing tags are never wiped. Upsert without tags, then
    // append the tags via the contact-scoped tag endpoint. ----
    const pathNoQuery = path.split('?')[0]
    if (
      method === 'POST' &&
      pathNoQuery === '/contacts/upsert' &&
      body && typeof body === 'object' && !Array.isArray(body) &&
      Array.isArray((body as Record<string, unknown>).tags) &&
      ((body as Record<string, unknown>).tags as unknown[]).length > 0
    ) {
      const bodyObj = body as Record<string, unknown>
      const tags = bodyObj.tags as unknown[]
      const upsertBody: Record<string, unknown> = { ...bodyObj }
      delete upsertBody.tags
      const up = await ghlFetch('POST', path, token, upsertBody)
      const upBody = up.body as { contact?: { id?: string }; id?: string } | null
      const contactId = upBody?.contact?.id ?? upBody?.id
      let tagResult: { status: number; body: unknown } | null = null
      if (up.status >= 200 && up.status < 300 && contactId) {
        const tg = await ghlFetch('POST', `/contacts/${contactId}/tags`, token, { tags })
        tagResult = { status: tg.status, body: tg.body }
      }
      return new Response(
        JSON.stringify({ ...up, tagResult, additiveTagging: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const result = await ghlFetch(method, path, token, body)
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
