import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

// Convert UTC "now" to user's local time using Intl
function getLocalTime(tz: string): { hour: number; min: number } {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value || '0'
  return { hour: parseInt(get('hour')), min: parseInt(get('minute')) }
}

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ACCOUNT_SID  = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const AUTH_TOKEN   = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const FROM_NUMBER  = Deno.env.get('TWILIO_PHONE_NUMBER')!
  const credentials  = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)

  // UTC date — matches what the client stores in med_logs/reminder_logs
  const todayStr = new Date().toISOString().split('T')[0]

  // Get all active medications with reminders enabled
  const { data: meds, error: medsErr } = await supabase
    .from('medications')
    .select('id, user_id, med_name, dosage, times, reminder_phone')
    .eq('active', true)
    .eq('reminder_enabled', true)
    .not('reminder_phone', 'is', null)

  if (medsErr) {
    console.error('Failed to fetch medications:', medsErr.message)
    return new Response(JSON.stringify({ sent: 0, error: medsErr.message }), { status: 500 })
  }

  if (!meds?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No reminder meds found' }), { status: 200 })
  }

  // Fetch timezone for each user so we compare against their local clock
  const userIds = [...new Set(meds.map(m => m.user_id))]
  const { data: profiles } = await supabase
    .from('user_profile')
    .select('user_id, timezone')
    .in('user_id', userIds)

  const tzMap = new Map<string, string>()
  for (const p of (profiles || [])) {
    tzMap.set(p.user_id, p.timezone || 'America/New_York')
  }

  let sent = 0
  const errors: string[] = []

  for (const med of meds) {
    // #16: Each medication wrapped in try/catch — one failure won't stop the rest
    try {
      // #10: Use user's local time, not UTC, for the ±5 min window check
      const userTz = tzMap.get(med.user_id) || 'America/New_York'
      const { hour: localHour, min: localMin } = getLocalTime(userTz)
      const currentMins = localHour * 60 + localMin

      for (const scheduledTime of (med.times || [])) {
        const [sh, sm] = scheduledTime.split(':').map(Number)
        const scheduledMins = sh * 60 + sm

        // Only send if within ±5 minute window of user's LOCAL time
        if (Math.abs(currentMins - scheduledMins) > 5) continue

        // Skip if already taken today
        const { data: taken } = await supabase
          .from('med_logs')
          .select('id')
          .eq('medication_id', med.id)
          .eq('date', todayStr)
          .eq('scheduled_time', scheduledTime)
          .limit(1)

        if (taken?.length) continue

        // Skip if reminder already sent today for this dose
        const { data: alreadySent } = await supabase
          .from('reminder_logs')
          .select('id')
          .eq('medication_id', med.id)
          .eq('date', todayStr)
          .eq('scheduled_time', scheduledTime)
          .limit(1)

        if (alreadySent?.length) continue

        const toPhone   = normalizePhone(med.reminder_phone)
        const medDisplay = med.dosage ? `${med.med_name} ${med.dosage}` : med.med_name
        const message   = `💊 Medication reminder: Time to take your ${medDisplay}. — SeniorSafe`

        // Send SMS via Twilio
        const body = new URLSearchParams({ To: toPhone, From: FROM_NUMBER, Body: message })
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
          }
        )

        const result = await response.json()
        console.log(`SMS to ${toPhone} (tz=${userTz}):`, response.status, result?.sid || result?.message)

        // Only log and count if Twilio actually accepted the message
        if (response.ok) {
          await supabase.from('reminder_logs').insert({
            medication_id: med.id,
            user_id: med.user_id,
            date: todayStr,
            scheduled_time: scheduledTime,
            sent_at: new Date().toISOString(),
          })
          sent++
        } else {
          console.error(`Twilio error for med ${med.id}:`, result?.message || response.status)
        }
      }
    } catch (err) {
      const errMsg = `Error processing med ${med.id}: ${(err as Error).message}`
      console.error(errMsg)
      errors.push(errMsg)
    }
  }

  return new Response(JSON.stringify({ sent, errors: errors.length ? errors : undefined }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
