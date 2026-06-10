import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// GHL contacts helper. Reuses GHL_PIT_TOKEN + GHL_LOCATION_ID. Gated by x-proxy-secret == SOCIAL_PROXY_SECRET.
// SAFE actions only: search (read), get_contact (read), add_tag (write, reversible), set_dnd (write, reversible). NO delete.

const BASE = 'https://services.leadconnectorhq.com'
const VER = '2021-07-28'
function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }) }
function safeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }
async function ghl(method: string, path: string, token: string, body?: unknown) {
  const init: RequestInit = { method, headers: { 'Authorization': `Bearer ${token}`, 'Version': VER, 'Accept': 'application/json' }, signal: AbortSignal.timeout(30000) }
  if (body !== undefined && method !== 'GET') { (init.headers as Record<string,string>)['Content-Type']='application/json'; init.body = JSON.stringify(body) }
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text(); let parsed: unknown; try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed }
}
serve(async (req: Request) => {
  if (req.method !== 'POST') return j({ error: 'POST only' }, 405)
  const sec = Deno.env.get('SOCIAL_PROXY_SECRET') || ''
  if (sec) { const p = req.headers.get('x-proxy-secret') || ''; if (!p || !safeEqual(p, sec)) return j({ error: 'Unauthorized' }, 401) }
  const token = Deno.env.get('GHL_PIT_TOKEN') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!token || !loc) return j({ error: 'GHL token/location not set' }, 500)
  let payload: { action?: string; params?: Record<string, any> }
  try { payload = await req.json() } catch { return j({ error: 'invalid JSON' }, 400) }
  const action = payload.action; const p = payload.params ?? {}
  try {
    if (action === 'search') {
      const bodyReq: Record<string, unknown> = { locationId: loc, pageLimit: p.limit || 100 }
      if (p.query) bodyReq.query = p.query
      const r = await ghl('POST', '/contacts/search', token, bodyReq)
      const contacts = (r.body as any)?.contacts || []
      const slim = contacts.map((c: any) => ({ id: c.id, name: [c.firstName,c.lastName].filter(Boolean).join(' ') || c.contactName || '', email: c.email || '', phone: c.phone || '', tags: c.tags || [], dnd: c.dnd }))
      return j({ ok: r.status>=200&&r.status<300, httpStatus: r.status, count: slim.length, total: (r.body as any)?.total, contacts: slim })
    }
    if (action === 'get_contact') { if (!p.id) return j({ error: 'need id' }, 400); return j(await ghl('GET', `/contacts/${p.id}`, token)) }
    if (action === 'add_tag') { if (!p.id || !p.tags) return j({ error: 'need id + tags[]' }, 400); const r = await ghl('POST', `/contacts/${p.id}/tags`, token, { tags: p.tags }); return j({ ok: r.status>=200&&r.status<300, httpStatus: r.status, response: r.body }) }
    if (action === 'set_dnd') { if (!p.id) return j({ error: 'need id' }, 400); const r = await ghl('PUT', `/contacts/${p.id}`, token, { dnd: p.dnd !== false }); return j({ ok: r.status>=200&&r.status<300, httpStatus: r.status, response: r.body }) }
    return j({ error: `unknown action: ${action}` }, 400)
  } catch (e) { return j({ error: e instanceof Error ? e.message : 'unknown' }, 500) }
})
