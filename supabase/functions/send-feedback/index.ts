import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// CORS
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

// Module-scope admin client (bypasses RLS; used for token verify + inserts)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // --- Auth: manually verify the JWT (verify_jwt = false at gateway) ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      console.error('Auth error:', authError)
      return new Response(JSON.stringify({ error: 'Invalid token', detail: authError?.message }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.log('Authenticated user:', user.id, user.email)

    // --- Validate body ---
    const { message, platform, app_version } = await req.json()
    if (!message || typeof message !== 'string' || !message.trim()) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const messageTrimmed = message.trim().slice(0, 5000)

    // --- Look up family_name for context ---
    const { data: profile } = await supabaseAdmin
      .from('user_profile')
      .select('family_name, first_name, last_name')
      .eq('user_id', user.id)
      .single()

    const familyName = profile?.family_name || null
    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || '(no name)'
    const userEmail = user.email || '(no email)'
    const timestamp = new Date().toISOString()

    // --- Insert into feedback table (service-role; bypasses RLS) ---
    const { error: insertError } = await supabaseAdmin.from('feedback').insert({
      user_id: user.id,
      user_email: userEmail,
      family_name: familyName,
      message: messageTrimmed,
      platform: platform || null,
      app_version: app_version || null,
    })
    if (insertError) {
      console.error('DB insert error:', insertError)
      // Don't bail — still try to send the email so feedback isn't lost
    }

    // --- Send email via Resend ---
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY missing — feedback saved to DB but not emailed')
      return new Response(JSON.stringify({
        ok: true,
        emailed: false,
        warning: 'Feedback stored but email service not configured.',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const textBody = [
      `SeniorSafe Feedback`,
      ``,
      `From: ${fullName} <${userEmail}>`,
      `User ID: ${user.id}`,
      `Family: ${familyName || '(none)'}`,
      `Platform: ${platform || 'unknown'}`,
      `App version: ${app_version || 'unknown'}`,
      `Timestamp: ${timestamp}`,
      ``,
      `------------------------------------------------------------`,
      messageTrimmed,
      `------------------------------------------------------------`,
    ].join('\n')

    const htmlBody = `
      <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#1B365D">
        <h2 style="margin:0 0 12px 0;color:#1B365D">SeniorSafe Feedback</h2>
        <table style="border-collapse:collapse;font-size:13px;color:#374151">
          <tr><td style="padding:2px 12px 2px 0;color:#6B7280">From</td><td>${escapeHtml(fullName)} &lt;${escapeHtml(userEmail)}&gt;</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6B7280">User ID</td><td><code>${escapeHtml(user.id)}</code></td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6B7280">Family</td><td>${escapeHtml(familyName || '(none)')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6B7280">Platform</td><td>${escapeHtml(platform || 'unknown')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6B7280">App version</td><td>${escapeHtml(app_version || 'unknown')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6B7280">Timestamp</td><td>${escapeHtml(timestamp)}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #E5E7EB;margin:16px 0" />
        <div style="white-space:pre-wrap;font-size:14px;line-height:1.5;color:#111827;background:#F9FAFB;padding:12px 14px;border-radius:8px;border:1px solid #E5E7EB">${escapeHtml(messageTrimmed)}</div>
        <p style="font-size:12px;color:#9CA3AF;margin-top:16px">Reply to this email to respond directly to ${escapeHtml(userEmail)}.</p>
      </div>
    `.trim()

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SeniorSafe Feedback <alerts@seniorsafeapp.com>',
        to: ['support@seniorsafeapp.com'],
        reply_to: userEmail,
        subject: `SeniorSafe Feedback from ${userEmail}`,
        text: textBody,
        html: htmlBody,
      }),
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      console.error(`Resend failed (${emailRes.status}):`, errText)
      return new Response(JSON.stringify({
        error: 'Email delivery failed',
        detail: errText,
        status: emailRes.status,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Feedback email sent for ${userEmail}`)
    return new Response(JSON.stringify({ ok: true, emailed: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-feedback error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
