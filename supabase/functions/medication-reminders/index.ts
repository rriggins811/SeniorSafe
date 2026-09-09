import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { isServiceBearer } from '../_shared/cronAuth.ts'

// Medication reminders. Runs every 5 minutes (pg_cron).
//
// 2026-09-08: notifications only, no texts. Two things happen here:
//   1. At dose time (within 5 minutes) the senior's phone gets a notification
//      if the SeniorSafe app is installed. On the web the due-medicine card on
//      the senior's home screen is the reminder.
//   2. If a dose is still not marked taken 60 minutes after its time, the
//      rest of the family gets a notification, once per dose per day.
// Ryan's father takes about 15 medications a day; at a text each that would
// have been the most expensive feature in the app.

// Convert UTC "now" to a user's local clock
function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function getLocalTime(tz: string): { hour: number; min: number; date: string } {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value || '0'
  return {
    hour: parseInt(get('hour')) % 24,
    min: parseInt(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

const MISSED_AFTER_MINUTES = 60
const MISSED_WINDOW_MINUTES = 180 // stop alerting 3 hours after the dose time

serve(async (req) => {
  // Cron endpoint: only the service role may call it.
  const authHeader = req.headers.get('Authorization') || ''
  if (!(await isServiceBearer(req))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`
  const pushHeaders = {
    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    'Content-Type': 'application/json',
  }

  async function push(userIds: string[], title: string, body: string, type: string, route: string): Promise<number> {
    if (userIds.length === 0) return 0
    try {
      const res = await fetch(pushUrl, {
        method: 'POST', headers: pushHeaders,
        body: JSON.stringify({ user_ids: userIds, title, body, notification_type: type, data: { route } }),
      })
      const json = await res.json().catch(() => null)
      return (json?.results || []).filter((r: { push: boolean }) => r.push).length
    } catch (err) {
      console.error('push error:', (err as Error).message)
      return 0
    }
  }

  // Active medications with reminders on. reminder_phone is no longer used
  // for delivery; it only marks that reminders are wanted.
  const { data: meds, error: medsErr } = await supabase
    .from('medications')
    .select('id, user_id, family_name, med_name, dosage, times')
    .eq('active', true)
    .eq('reminder_enabled', true)

  if (medsErr) {
    console.error('Failed to fetch medications:', medsErr.message)
    return new Response(JSON.stringify({ sent: 0, error: medsErr.message }), { status: 500 })
  }
  if (!meds?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No reminder meds found' }), { status: 200 })
  }

  // Family for each medication: the row that entered it may be the adult
  // child, so resolve the family root and find the senior and the others.
  const userIds = [...new Set(meds.map(m => m.user_id))]
  const { data: enterers } = await supabase
    .from('user_profile').select('user_id, invited_by, timezone').in('user_id', userIds)
  const rootOf = new Map<string, string>()
  for (const p of (enterers || [])) rootOf.set(p.user_id, p.invited_by || p.user_id)
  const roots = [...new Set([...rootOf.values()])]
  const { data: familyRows } = await supabase
    .from('user_profile')
    .select('user_id, invited_by, is_senior, first_name, senior_name, timezone, device_token, subscription_tier')
    .or(roots.map(r => `user_id.eq.${r},invited_by.eq.${r}`).join(','))
  const familiesByRoot = new Map<string, typeof familyRows>()
  for (const r of (familyRows || [])) {
    const root = r.invited_by || r.user_id
    if (!familiesByRoot.has(root)) familiesByRoot.set(root, [])
    familiesByRoot.get(root)!.push(r)
  }

  let reminders = 0
  let missedAlerts = 0
  const errors: string[] = []

  for (const med of meds) {
    try {
      const root = rootOf.get(med.user_id) || med.user_id
      const fam = familiesByRoot.get(root) || []
      const senior = fam.find(r => r.is_senior) || null
      const owner = fam.find(r => r.user_id === root) || null
      const seniorName = senior?.first_name || owner?.senior_name || 'Your loved one'
      const tz = senior?.timezone || owner?.timezone || 'America/New_York'
      const { hour, min, date: todayLocal } = getLocalTime(tz)
      const nowMins = hour * 60 + min
      const medDisplay = med.dosage ? `${med.med_name} ${med.dosage}` : med.med_name

      for (const scheduledTime of (med.times || [])) {
        const [sh, sm] = scheduledTime.split(':').map(Number)
        const scheduledMins = sh * 60 + sm
        // Minutes since the dose was due. A dose due late last night is still
        // inside its window after midnight, so measure it across the day line
        // instead of letting the clock wrap to a negative number.
        let sinceDue = nowMins - scheduledMins
        let doseDate = todayLocal
        const acrossMidnight = nowMins + 1440 - scheduledMins
        if (sinceDue < -60 && acrossMidnight <= MISSED_WINDOW_MINUTES) {
          sinceDue = acrossMidnight
          doseDate = dayBefore(todayLocal)
        }

        // Already taken? (med_logs date is what the client wrote; it matches
        // the local date the senior sees.)
        const { data: taken } = await supabase
          .from('med_logs').select('id')
          .eq('medication_id', med.id).eq('date', doseDate).eq('scheduled_time', scheduledTime).limit(1)
        if (taken?.length) continue

        // 1. Dose time: nudge the senior's phone (once).
        if (Math.abs(sinceDue) <= 5 && senior?.device_token) {
          const { data: already } = await supabase
            .from('reminder_logs').select('id')
            .eq('medication_id', med.id).eq('date', todayLocal).eq('scheduled_time', scheduledTime).limit(1)
          if (!already?.length) {
            const n = await push([senior.user_id], 'Time for your medicine', `${medDisplay}. Tap I took it when you have.`, 'medication_reminder', '/dashboard')
            await supabase.from('reminder_logs').insert({
              medication_id: med.id, user_id: senior.user_id, date: todayLocal, scheduled_time: scheduledTime, sent_at: new Date().toISOString(),
            })
            reminders += n
          }
        }

        // 2. Missed dose: tell the rest of the family (once per dose per day). Paid plan only.
        const paidFamily = ['paid', 'trial', 'premium_plus'].includes(owner?.subscription_tier || '')
        if (paidFamily && sinceDue >= MISSED_AFTER_MINUTES && sinceDue <= MISSED_WINDOW_MINUTES) {
          // Claim the slot first (unique on medication, date, time) so an overlapping run cannot double-send.
          const others = fam.filter(r => !r.is_senior).map(r => r.user_id)
          const { data: claimed, error: claimErr } = await supabase.from('dose_alerts').insert({
            medication_id: med.id, family_root: root, date: doseDate, scheduled_time: scheduledTime, notified: others.length, delivered: 0,
          }).select('id').single()
          if (claimErr || !claimed) continue
          const n = await push(others, `${seniorName} may have missed a dose`, `${medDisplay} was due at ${fmt12(scheduledTime)} and is not marked as taken.`, 'missed_dose', '/medications')
          await supabase.from('dose_alerts').update({ delivered: n }).eq('id', claimed.id)
          missedAlerts += n
        }
      }
    } catch (err) {
      const errMsg = `Error processing med ${med.id}: ${(err as Error).message}`
      console.error(errMsg)
      errors.push(errMsg)
    }
  }

  return new Response(JSON.stringify({ reminders, missedAlerts, errors: errors.length ? errors : undefined }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
