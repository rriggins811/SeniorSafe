import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Missed check-in alerts. Runs as cron every 30 minutes.
//
// 2026-09-04 rewrite for the setup rebuild. The person who checks in is the
// row with is_senior = true, which may be the family owner (set up for
// themselves) or a member the owner invited. The family is keyed by
// COALESCE(invited_by, user_id) = the owner's user_id. The owner holds the
// subscription and the check-in time; the senior's row holds the timezone.
// Everyone in the family except the senior is alerted.

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

function getLocalDate(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
}

function getLocalTime(tz: string): { hour: number; min: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
  const parts = fmt.format(new Date()).split(':')
  return { hour: parseInt(parts[0], 10) % 24, min: parseInt(parts[1], 10) }
}

async function sendFailureAlertEmail(familyName: string, phone: string, seniorName: string, errorDetail: string): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const body = [
    `MISSED CHECK-IN SMS FAILED`, ``,
    `Senior: ${seniorName}`, `Family: ${familyName || 'Unknown'}`, `Failed phone: ${phone}`,
    `Error: ${errorDetail}`, `Time: ${new Date().toISOString()}`, ``,
    `The family member above did NOT receive a missed check-in alert.`, `Please follow up manually.`,
  ].join('\n')
  if (!RESEND_API_KEY) {
    console.error(`SMS_FAILURE_ALERT — No RESEND_API_KEY configured. Details:\n${body}`)
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'SeniorSafe Alerts <alerts@seniorsafeapp.com>', to: ['support@seniorsafeapp.com'], subject: 'ALERT: Missed check-in SMS failed', text: body }),
    })
    if (res.ok) return true
    console.error(`Resend email failed (${res.status}):`, await res.text())
    console.error(`SMS_FAILURE_ALERT:\n${body}`)
    return false
  } catch (emailErr) {
    console.error('Resend email error:', emailErr)
    console.error(`SMS_FAILURE_ALERT:\n${body}`)
    return false
  }
}

type ProfileRow = {
  user_id: string
  first_name: string | null
  senior_name: string | null
  phone: string | null
  device_token: string | null
  device_platform: string | null
  timezone: string | null
  checkin_alert_time: string | null
  subscription_tier: string | null
  role: string | null
  invited_by: string | null
  is_senior: boolean
  family_name: string | null
}

serve(async (_req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!
  const credentials = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)

  // 1. Every senior.
  const { data: seniors, error: sErr } = await supabase
    .from('user_profile')
    .select('user_id, first_name, senior_name, phone, device_token, device_platform, timezone, checkin_alert_time, subscription_tier, role, invited_by, is_senior, family_name')
    .eq('is_senior', true)

  if (sErr) {
    console.error('Error fetching seniors:', sErr.message)
    return new Response(JSON.stringify({ error: sErr.message }), { status: 500 })
  }
  if (!seniors?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No seniors found' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  let totalSent = 0
  let skipped = 0
  let checked = 0

  for (const senior of seniors as ProfileRow[]) {
    try {
      const ownerId = senior.invited_by || senior.user_id

      // 2. The owner holds the plan and the check-in time.
      let owner: ProfileRow = senior
      if (ownerId !== senior.user_id) {
        const { data: o } = await supabase
          .from('user_profile')
          .select('user_id, first_name, senior_name, phone, device_token, device_platform, timezone, checkin_alert_time, subscription_tier, role, invited_by, is_senior, family_name')
          .eq('user_id', ownerId)
          .single()
        if (!o) { skipped++; continue }
        owner = o as ProfileRow
      }

      // Only paid and trial families get the alert.
      if (!['paid', 'trial', 'premium_plus'].includes(owner.subscription_tier || '')) { skipped++; continue }
      checked++

      const tz = senior.timezone || owner.timezone || 'America/New_York'
      const alertTime = owner.checkin_alert_time || '12:00'
      const [alertH, alertM] = alertTime.split(':').map(Number)
      const local = getLocalTime(tz)
      if (local.hour * 60 + local.min < alertH * 60 + alertM) { skipped++; continue }

      const todayLocal = getLocalDate(tz)

      // Dedup: one alert per senior per local day. admin_id keeps its old
      // name but now holds the senior's user_id.
      const { data: alreadySent } = await supabase
        .from('checkin_alert_logs').select('id').eq('admin_id', senior.user_id).eq('date', todayLocal).limit(1)
      if (alreadySent?.length) { skipped++; continue }

      // Has the senior checked in today (their local day)?
      const dayStartUtc = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
      dayStartUtc.setHours(0, 0, 0, 0)
      const offsetMs = new Date().getTime() - new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getTime()
      const dayStartIso = new Date(dayStartUtc.getTime() + offsetMs).toISOString()
      const { data: checkins } = await supabase
        .from('checkins').select('id').eq('user_id', senior.user_id).gte('checked_in_at', dayStartIso).limit(1)
      if (checkins?.length) { skipped++; continue }

      // 3. Everyone in the family except the senior.
      const { data: familyRows } = await supabase
        .from('user_profile')
        .select('user_id, first_name, phone, device_token, device_platform')
        .or(`user_id.eq.${ownerId},invited_by.eq.${ownerId}`)
      const recipients = (familyRows || []).filter(r => r.user_id !== senior.user_id)
      if (recipients.length === 0) { skipped++; continue }

      const seniorName = senior.first_name || owner.senior_name || 'Your loved one'
      const familyLabel = owner.family_name || senior.family_name || seniorName
      const message = `${seniorName} hasn't checked in today. — SeniorSafe. Reply STOP to opt out`

      for (const member of recipients) {
        if (!member.device_token) continue
        try {
          const pushRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_ids: [member.user_id],
              title: 'Missed Check-In',
              body: `${seniorName} hasn't checked in yet today.`,
              notification_type: 'missed_check_in',
              data: { route: '/dashboard' },
            }),
          })
          if (pushRes.ok) console.log(`Push sent to ${member.first_name} for missed check-in`)
        } catch (pushErr) {
          console.error(`Push error for ${member.first_name}:`, pushErr)
        }
      }

      for (const member of recipients) {
        if (!member.phone) continue
        const toPhone = normalizePhone(member.phone)
        try {
          const body = new URLSearchParams({ To: toPhone, From: FROM_NUMBER, Body: message })
          const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          })
          if (response.ok) {
            totalSent++
            console.log(`Missed check-in SMS sent to ${member.first_name} (${toPhone}) for senior ${senior.user_id}`)
          } else {
            const errText = await response.text()
            console.error(`Twilio error for ${toPhone}:`, errText)
            await sendFailureAlertEmail(familyLabel, toPhone, seniorName, `Twilio HTTP ${response.status}: ${errText}`)
          }
        } catch (smsErr) {
          console.error(`SMS error for member ${member.first_name}:`, smsErr)
          await sendFailureAlertEmail(familyLabel, toPhone, seniorName, `Exception: ${smsErr}`)
        }
      }

      await supabase.from('checkin_alert_logs').insert({ admin_id: senior.user_id, date: todayLocal })
      console.log(`Logged alert for senior ${senior.user_id} on ${todayLocal}`)
    } catch (err) {
      console.error(`Error processing senior ${senior.user_id}:`, err)
    }
  }

  const result = { sent: totalSent, skipped, seniorsChecked: checked, seniorsTotal: seniors.length }
  console.log('Missed check-in alerts result:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
