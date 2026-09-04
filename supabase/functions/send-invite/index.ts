import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Send an invite text from the server, so the adult child does not have to
// forward a link from their own Messages app.
//
//   POST { kind: 'senior' }                 owner only; texts user_profile.senior_phone
//   POST { kind: 'member', to: '3365550100' } any family member; texts a phone they typed
//
// Both are rate limited to 6 invite texts per person per day, logged to
// notification_log as notification_type 'invite'. The senior invite also
// stamps invite_sent_at so the invite-reminders cron knows when to nudge.
//
// The wording here must stay in step with src/lib/family.js (seniorInviteText,
// memberInviteText); the app shows the same text in the "text it yourself"
// fallback.

const APP_URL = 'https://app.seniorsafeapp.com'
const DAILY_LIMIT = 6

const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'http://localhost:5173',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

function normalizePhone(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function seniorInviteText(seniorName: string, ownerFirst: string, code: string): string {
  const who = ownerFirst || 'Your family'
  return `Hi ${seniorName || 'there'}, it's ${who}. I set up SeniorSafe so you can let me know you're okay each morning with one tap. Open this link on your phone and follow the steps: ${APP_URL}/signup?code=${code}&who=senior`
}

function memberInviteText(seniorName: string, code: string): string {
  const whom = seniorName ? `${seniorName}'s` : "our family's"
  return `Join ${whom} SeniorSafe family so you get the daily "I'm okay" check-in too. Tap this link and sign up: ${APP_URL}/signup?code=${code}`
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

async function sendTwilio(to: string, body: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const from = Deno.env.get('TWILIO_PHONE_NUMBER')!
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

serve(async (req) => {
  const headers = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return reply({ error: 'Missing authorization' }, 401)
    const { data: { user }, error: authErr } = await admin.auth.getUser(auth.slice(7))
    if (authErr || !user) return reply({ error: 'Please sign in again.' }, 401)

    const body = await req.json().catch(() => ({}))
    const kind = body?.kind === 'member' ? 'member' : body?.kind === 'senior' ? 'senior' : null
    if (!kind) return reply({ error: 'kind must be senior or member' }, 400)

    const { data: me } = await admin
      .from('user_profile')
      .select('user_id, role, invited_by, first_name, family_name, family_code, senior_name, senior_phone, is_senior')
      .eq('user_id', user.id)
      .single()
    if (!me) return reply({ error: 'Profile not found' }, 404)

    const ownerId = me.invited_by || me.user_id
    let owner = me
    if (ownerId !== me.user_id) {
      const { data: o } = await admin
        .from('user_profile')
        .select('user_id, role, invited_by, first_name, family_name, family_code, senior_name, senior_phone, is_senior')
        .eq('user_id', ownerId)
        .single()
      if (!o) return reply({ error: 'Family not found' }, 404)
      owner = o
    }
    if (!owner.family_code) return reply({ error: 'This family has no invite code yet.' }, 400)

    // Rate limit: invites sent by this person today.
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
    const { count: sentToday } = await admin
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('notification_type', 'invite')
      .gte('created_at', dayStart.toISOString())
    if ((sentToday || 0) >= DAILY_LIMIT) {
      return reply({ error: `You've sent ${DAILY_LIMIT} invites today. Try again tomorrow, or copy the link instead.` }, 429)
    }

    // Who is the senior's name, for wording.
    const { data: seniorRow } = await admin
      .from('user_profile')
      .select('user_id, first_name')
      .eq('is_senior', true)
      .or(`user_id.eq.${ownerId},invited_by.eq.${ownerId}`)
      .maybeSingle()
    const seniorName = seniorRow?.first_name || owner.senior_name || ''

    let to: string | null = null
    let text = ''
    if (kind === 'senior') {
      if (me.user_id !== ownerId) return reply({ error: 'Only the person who set up the family can invite the senior.' }, 403)
      if (seniorRow) return reply({ error: `${seniorName || 'They'} already joined.` }, 409)
      to = normalizePhone(owner.senior_phone || '')
      if (!to) return reply({ error: 'Add their mobile number first.' }, 400)
      text = seniorInviteText(seniorName, owner.first_name || '', owner.family_code)
    } else {
      to = normalizePhone(body?.to || '')
      if (!to) return reply({ error: 'Enter a 10-digit mobile number.' }, 400)
      text = memberInviteText(seniorName, owner.family_code)
    }

    const { data: log } = await admin.from('notification_log').insert({
      user_id: user.id,
      family_name: owner.family_name || me.family_name || null,
      notification_type: 'invite',
      channel: 'sms',
      status: 'pending',
      retry_count: 0,
      recipient_phone: to,
    }).select('id').single()

    const result = await sendTwilio(to, text)
    if (!result.ok) {
      const msg = result.data?.message || `Twilio error ${result.status}`
      if (log?.id) await admin.from('notification_log').update({ status: 'failed', error_message: msg, updated_at: new Date().toISOString() }).eq('id', log.id)
      console.error('[SEND-INVITE] failed', { user: user.id, kind, status: result.status, msg })
      return reply({ error: 'The text did not go through. You can copy the link and send it yourself.' }, 502)
    }

    if (log?.id) await admin.from('notification_log').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', log.id)
    if (kind === 'senior') {
      await admin.from('user_profile').update({ invite_sent_at: new Date().toISOString() }).eq('user_id', ownerId)
    }

    const masked = `(${to.slice(2, 5)}) ${to.slice(5, 8)}-${to.slice(8)}`
    return reply({ ok: true, to: masked })
  } catch (err) {
    console.error('[SEND-INVITE] error', err)
    return reply({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
