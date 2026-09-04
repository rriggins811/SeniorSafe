import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Invite reminders. Runs once a day (cron, see 20260904_invite_delivery.sql).
//
// For every family where the adult child set things up but the senior has not
// opened their link yet: about a day after the last invite, text the senior
// the link again and tell the adult child we did. Two reminders at most, then
// we stop and leave it to the adult child.
//
// Invoked by pg_cron with the service role key as Bearer. Nothing else may
// call it.

const APP_URL = 'https://app.seniorsafeapp.com'
const MAX_REMINDERS = 2
const MIN_GAP_HOURS = 20

function normalizePhone(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

async function sendTwilio(to: string, body: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const from = Deno.env.get('TWILIO_PHONE_NUMBER')!
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }
}

serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') || ''
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Owners who set up for someone else, finished setup, gave us a number, and
  // still have reminders left.
  const { data: owners, error } = await admin
    .from('user_profile')
    .select('user_id, first_name, family_name, family_code, senior_name, senior_phone, phone, created_at, invite_sent_at, invite_reminders_sent')
    .eq('role', 'admin')
    .eq('is_senior', false)
    .eq('onboarding_complete', true)
    .not('senior_phone', 'is', null)
    .lt('invite_reminders_sent', MAX_REMINDERS)

  if (error) {
    console.error('[INVITE-REMINDERS] query failed', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  let sent = 0, skipped = 0, failed = 0
  const cutoff = Date.now() - MIN_GAP_HOURS * 3600 * 1000

  for (const o of owners || []) {
    try {
      const last = new Date(o.invite_sent_at || o.created_at).getTime()
      if (last > cutoff) { skipped++; continue }

      const { data: senior } = await admin
        .from('user_profile').select('user_id').eq('is_senior', true).eq('invited_by', o.user_id).maybeSingle()
      if (senior) { skipped++; continue }

      const to = normalizePhone(o.senior_phone || '')
      if (!to || !o.family_code) { skipped++; continue }

      const name = o.senior_name || 'there'
      const who = o.first_name || 'Your family'
      const link = `${APP_URL}/signup?code=${o.family_code}&who=senior`
      const n = (o.invite_reminders_sent || 0) + 1

      const seniorMsg = `Hi ${name}, it's ${who} again. Here's your SeniorSafe link. Open it on your phone and it takes about a minute: ${link}`
      const r = await sendTwilio(to, seniorMsg)
      await admin.from('notification_log').insert({
        user_id: o.user_id, family_name: o.family_name, notification_type: 'invite_reminder', channel: 'sms',
        status: r.ok ? 'sent' : 'failed', retry_count: 0, recipient_phone: to,
        error_message: r.ok ? null : (r.data?.message || `Twilio error ${r.status}`),
      })
      if (!r.ok) { failed++; continue }

      const ownerTo = normalizePhone(o.phone || '')
      if (ownerTo) {
        const tail = n >= MAX_REMINDERS
          ? `That was the last automatic reminder. If it's easier, open this on ${name}'s phone yourself: ${link}`
          : `We'll try once more tomorrow. You can also open this on ${name}'s phone yourself: ${link}`
        await sendTwilio(ownerTo, `${name} hasn't opened the SeniorSafe link yet, so we just sent it again. ${tail}`)
      }

      await admin.from('user_profile')
        .update({ invite_sent_at: new Date().toISOString(), invite_reminders_sent: n })
        .eq('user_id', o.user_id)
      sent++
    } catch (err) {
      console.error('[INVITE-REMINDERS] owner failed', o.user_id, err)
      failed++
    }
  }

  const result = { sent, skipped, failed, checked: (owners || []).length }
  console.log('Invite reminders result:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
