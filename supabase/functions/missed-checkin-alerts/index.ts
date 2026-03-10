import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

/** Current date string (YYYY-MM-DD) in a given IANA timezone. */
function getLocalDate(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz }) // en-CA → YYYY-MM-DD
}

/** Current hour + minute in a given IANA timezone. */
function getLocalTime(tz: string): { hour: number; min: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.format(new Date()).split(':')
  return { hour: parseInt(parts[0], 10), min: parseInt(parts[1], 10) }
}

// ---------------------------------------------------------------------------
// Main handler — runs as cron every 30 minutes
// ---------------------------------------------------------------------------
serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!
  const credentials = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)

  // 1. Get all PAID admins (only paid tier gets missed check-in alerts)
  const { data: admins, error: adminErr } = await supabase
    .from('user_profile')
    .select('user_id, senior_name, first_name, timezone, checkin_alert_time')
    .eq('role', 'admin')
    .eq('subscription_tier', 'paid')

  if (adminErr) {
    console.error('Error fetching admins:', adminErr.message)
    return new Response(JSON.stringify({ error: adminErr.message }), { status: 500 })
  }

  if (!admins?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No paid admins found' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let totalSent = 0
  let skipped = 0

  for (const admin of admins) {
    try {
      const tz = admin.timezone || 'America/New_York'
      const alertTime = admin.checkin_alert_time || '12:00'
      const [alertH, alertM] = alertTime.split(':').map(Number)

      // Check if current local time is past the alert time
      const local = getLocalTime(tz)
      const localMins = local.hour * 60 + local.min
      const alertMins = alertH * 60 + alertM
      if (localMins < alertMins) {
        skipped++
        continue // Not time yet for this admin
      }

      const todayLocal = getLocalDate(tz)

      // Check dedup — already alerted today?
      const { data: alreadySent } = await supabase
        .from('checkin_alert_logs')
        .select('id')
        .eq('admin_id', admin.user_id)
        .eq('date', todayLocal)
        .limit(1)

      if (alreadySent?.length) {
        skipped++
        continue // Already sent today
      }

      // Check if senior has checked in today (using their local date)
      // Build start-of-day in the admin's timezone
      const dayStart = new Date(`${todayLocal}T00:00:00`)
      const { data: checkins } = await supabase
        .from('checkins')
        .select('id')
        .eq('user_id', admin.user_id)
        .gte('checked_in_at', dayStart.toISOString())
        .limit(1)

      if (checkins?.length) {
        skipped++
        continue // Already checked in today
      }

      // Get family members with phone numbers
      const { data: members } = await supabase
        .from('user_profile')
        .select('phone, first_name')
        .eq('invited_by', admin.user_id)
        .not('phone', 'is', null)

      if (!members?.length) {
        skipped++
        continue // No family members with phones
      }

      const seniorName = admin.senior_name || admin.first_name || 'Your loved one'
      const message = `${seniorName} hasn't checked in today. — SeniorSafe. Reply STOP to opt out`

      // Send SMS to each family member
      for (const member of members) {
        try {
          const toPhone = normalizePhone(member.phone)
          const body = new URLSearchParams({
            To: toPhone,
            From: FROM_NUMBER,
            Body: message,
          })

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

          if (response.ok) {
            totalSent++
            console.log(`✅ Missed check-in SMS sent to ${member.first_name} (${toPhone}) for admin ${admin.user_id}`)
          } else {
            const err = await response.text()
            console.error(`❌ Twilio error for ${toPhone}:`, err)
          }
        } catch (smsErr) {
          console.error(`SMS error for member ${member.first_name}:`, smsErr)
        }
      }

      // Insert dedup log
      await supabase.from('checkin_alert_logs').insert({
        admin_id: admin.user_id,
        date: todayLocal,
      })

      console.log(`📋 Logged alert for admin ${admin.user_id} on ${todayLocal}`)

    } catch (err) {
      console.error(`Error processing admin ${admin.user_id}:`, err)
      // Continue to next admin
    }
  }

  const result = { sent: totalSent, skipped, adminsChecked: admins.length }
  console.log('Missed check-in alerts result:', JSON.stringify(result))

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
