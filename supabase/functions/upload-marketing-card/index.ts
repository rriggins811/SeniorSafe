import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

// ---------------------------------------------------------------------------
// Upload marketing-card Edge Function (v4 - May 29, 2026)
// Uses supabase-js client which handles new-format service role keys (sb_secret_*)
// correctly. Holds SUPABASE_SERVICE_ROLE_KEY (built-in Edge Function env var)
// internally - caller only needs the public anon JWT.
//
// v4: added video/mp4 to allowed content types (for slideshow/reel posts).
//
// Action: upload
//   params: {
//     remote_path: string    // e.g. "2026-05-15/topic_1_big_stat.jpg"
//     content_type: string   // "image/jpeg", "image/png", or "video/mp4"
//     image_base64: string   // raw base64-encoded bytes
//   }
//   returns: { ok: true, public_url, bytes } or { ok: false, error }
// ---------------------------------------------------------------------------

const BUCKET = 'marketing-cards'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not available in Edge Function env' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let payload: { action?: string; params?: Record<string, unknown> }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (payload.action !== 'upload') {
    return new Response(
      JSON.stringify({ error: `Unknown action: ${payload.action}. Expected: upload.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const params = (payload.params ?? {}) as {
    remote_path?: string
    content_type?: string
    image_base64?: string
  }

  // Validation
  if (!params.remote_path || !params.content_type || !params.image_base64) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing one of: remote_path, content_type, image_base64' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (params.remote_path.includes('..') || params.remote_path.startsWith('/')) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid remote_path' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const datePrefix = /^\d{4}-\d{2}-\d{2}\//
  if (!datePrefix.test(params.remote_path)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'remote_path must start with YYYY-MM-DD/ (date prefix required)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const allowedTypes = ['image/jpeg', 'image/png', 'video/mp4']
  if (!allowedTypes.includes(params.content_type)) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid content_type. Allowed: ${allowedTypes.join(', ')}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(params.image_base64)
  } catch (_e) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid base64 data' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (bytes.length > 50 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ ok: false, error: `File too large: ${bytes.length} bytes (max 50MB)` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Use supabase-js client - handles new-format keys (sb_secret_*) correctly.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { error } = await supabase.storage.from(BUCKET).upload(
      params.remote_path,
      bytes,
      { contentType: params.content_type, upsert: true },
    )
    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: `Storage upload failed: ${error.message}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${params.remote_path}`
    return new Response(
      JSON.stringify({ ok: true, public_url: publicUrl, bytes: bytes.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
