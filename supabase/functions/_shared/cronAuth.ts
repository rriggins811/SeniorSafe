// Bearer check for functions that only the crons (or an operator) may call.
//
// 2026-09-09: an exact string compare against SUPABASE_SERVICE_ROLE_KEY broke
// every cron for 19 hours, because the key the runtime injects and the key in
// the vault are different valid service-role tokens. So: accept the runtime's
// own key, or any JWT whose role claim is service_role for this project AND
// that PostgREST accepts (PostgREST checks the signature, we do not have to).
export async function isServiceBearer(req: Request): Promise<boolean> {
  const header = req.headers.get('Authorization') || ''
  if (!header.startsWith('Bearer ')) return false
  const token = header.slice(7).trim()
  if (!token) return false
  const envKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (envKey && token === envKey) return true
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    if (payload?.role !== 'service_role') return false
    const url = Deno.env.get('SUPABASE_URL') || ''
    const ref = url.replace('https://', '').split('.')[0]
    if (payload?.ref && ref && payload.ref !== ref) return false
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    return res.status === 200
  } catch {
    return false
  }
}
