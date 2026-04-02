import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'http://localhost:5173',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

// Module-scope admin client for notification logging (bypasses RLS)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ---------------------------------------------------------------------------
// Send SMS via Twilio with retry logic (up to 3 attempts, 5 min between)
// ---------------------------------------------------------------------------
async function sendTwilioSMS(
  toPhone: string,
  message: string,
  accountSid: string,
  authToken: string,
  fromNumber: string,
): Promise<{ ok: boolean; data: any; status: number }> {
  const credentials = btoa(`${accountSid}:${authToken}`)
  const body = new URLSearchParams({ To: toPhone, From: fromNumber, Body: message })

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }
  )

  const data = await response.json()
  return { ok: response.ok, data, status: response.status }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // --- Auth: verify the caller has a valid Supabase JWT ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- Validate input ---
    const { to, message, notification_type } = await req.json()

    if (!to || !message) {
      return new Response(JSON.stringify({ error: 'to and message are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const digits = to.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 11) {
      return new Response(JSON.stringify({ error: 'Invalid phone number' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- Load user's family_name for notification log ---
    const { data: profile } = await supabase
      .from('user_profile')
      .select('family_name')
      .eq('user_id', user.id)
      .single()

    // --- Send SMS via Twilio ---
    const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!
    const toPhone = normalizePhone(to)

    // Create notification log entry
    const logType = notification_type || 'system'
    const { data: logEntry } = await supabaseAdmin
      .from('notification_log')
      .insert({
        user_id: user.id,
        family_name: profile?.family_name || null,
        notification_type: logType,
        channel: 'sms',
        status: 'pending',
        retry_count: 0,
        recipient_phone: toPhone,
      })
      .select('id')
      .single()

    const logId = logEntry?.id

    // Attempt 1
    let result = await sendTwilioSMS(toPhone, message, ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER)
    console.log('Twilio attempt 1:', result.status, JSON.stringify(result.data))

    if (result.ok) {
      // Update log as sent
      if (logId) {
        await supabaseAdmin.from('notification_log')
          .update({ status: 'sent', updated_at: new Date().toISOString() })
          .eq('id', logId)
      }
      return new Response(JSON.stringify(result.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Attempt 2 — wait 5 seconds (can't wait full 5 min in edge function due to timeout)
    // In production, retries > attempt 1 would be handled by a background cron.
    // For now, we do a quick retry within the same request.
    await new Promise(r => setTimeout(r, 5000))
    result = await sendTwilioSMS(toPhone, message, ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER)
    console.log('Twilio attempt 2:', result.status, JSON.stringify(result.data))

    if (result.ok) {
      if (logId) {
        await supabaseAdmin.from('notification_log')
          .update({ status: 'sent', retry_count: 1, updated_at: new Date().toISOString() })
          .eq('id', logId)
      }
      return new Response(JSON.stringify(result.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Attempt 3 — one more quick retry
    await new Promise(r => setTimeout(r, 5000))
    result = await sendTwilioSMS(toPhone, message, ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER)
    console.log('Twilio attempt 3:', result.status, JSON.stringify(result.data))

    if (result.ok) {
      if (logId) {
        await supabaseAdmin.from('notification_log')
          .update({ status: 'sent', retry_count: 2, updated_at: new Date().toISOString() })
          .eq('id', logId)
      }
      return new Response(JSON.stringify(result.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // All 3 attempts failed
    const errorMsg = result.data?.message || `Twilio error ${result.status}`
    if (logId) {
      await supabaseAdmin.from('notification_log')
        .update({
          status: 'failed',
          retry_count: 2,
          error_message: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', logId)
    }

    return new Response(JSON.stringify({ ...result.data, delivery_failed: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: result.status,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
