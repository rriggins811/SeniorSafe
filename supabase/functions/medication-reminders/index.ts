import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const GHL_API_KEY = Deno.env.get('GHL_API_KEY')!
  const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID')!
  const GHL_PHONE_NUMBER = Deno.env.get('GHL_PHONE_NUMBER')!

  const now = new Date()
  const currentHour = now.getUTCHours()
  const currentMin = now.getUTCMinutes()
  const todayStr = now.toISOString().split('T')[0]

  // Get all active medications with reminders enabled
  const { data: meds } = await supabase
    .from('medications')
    .select('id, user_id, med_name, dosage, times, reminder_phone')
    .eq('active', true)
    .eq('reminder_enabled', true)
    .not('reminder_phone', 'is', null)

  if (!meds?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No reminder meds found' }), { status: 200 })
  }

  let sent = 0

  for (const med of meds) {
    for (const scheduledTime of (med.times || [])) {
      const [sh, sm] = scheduledTime.split(':').map(Number)
      const scheduledMins = sh * 60 + sm
      const currentMins = currentHour * 60 + currentMin

      // Only send if within ±5 minute window
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

      // Format phone to E.164
      const digits = med.reminder_phone.replace(/\D/g, '')
      const toPhone = digits.startsWith('1') ? `+${digits}` : `+1${digits}`

      const medDisplay = med.dosage ? `${med.med_name} ${med.dosage}` : med.med_name

      // Send SMS via GHL
      await fetch('https://services.leadconnectorhq.com/conversations/messages/outbound', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15',
        },
        body: JSON.stringify({
          locationId: GHL_LOCATION_ID,
          type: 'SMS',
          message: `💊 Medication reminder: Time to take your ${medDisplay}. — SeniorSafe`,
          toNumber: toPhone,
          fromNumber: GHL_PHONE_NUMBER,
        }),
      })

      // Log so we don't send duplicate
      await supabase.from('reminder_logs').insert({
        medication_id: med.id,
        user_id: med.user_id,
        date: todayStr,
        scheduled_time: scheduledTime,
        sent_at: now.toISOString(),
      })

      sent++
    }
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
