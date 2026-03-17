import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/**
 * family-message-notify
 * Called by Postgres trigger (via pg_net) when a new family_messages row is inserted.
 * If the poster is an admin (senior), sends SMS to all family members.
 * Caps at 4 SMS-triggering messages per family per day.
 */

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

async function sendTwilioSMS(to: string, body: string): Promise<boolean> {
  const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!

  const credentials = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)
  const params = new URLSearchParams({
    To: normalizePhone(to),
    From: FROM_NUMBER,
    Body: body,
  })

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    )
    const data = await res.json()
    console.log(`SMS to ${to}: ${res.status}`, JSON.stringify(data))
    return res.ok
  } catch (err) {
    console.error(`SMS failed to ${to}:`, err)
    return false
  }
}

serve(async (req) => {
  // This function is called internally by the Postgres trigger via pg_net.
  // No CORS needed (server-to-server). No JWT needed (deployed with --no-verify-jwt).

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 })
  }

  try {
    const { record } = await req.json()

    if (!record?.user_id || !record?.family_name) {
      console.log('Missing user_id or family_name in payload, skipping.')
      return new Response(JSON.stringify({ skipped: true, reason: 'missing fields' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1) Check if the poster is an admin (senior) — only admins trigger SMS
    const { data: posterProfile } = await supabaseAdmin
      .from('user_profile')
      .select('role, first_name, family_code')
      .eq('user_id', record.user_id)
      .single()

    if (!posterProfile || posterProfile.role !== 'admin') {
      console.log(`Poster ${record.user_id} is not admin (role=${posterProfile?.role}), skipping SMS.`)
      return new Response(JSON.stringify({ skipped: true, reason: 'not admin' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 2) Check 4/day SMS cap — count today's admin messages in family_messages for this family
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { count: todayCount } = await supabaseAdmin
      .from('family_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', record.user_id)
      .eq('family_name', record.family_name)
      .gte('created_at', todayStart.toISOString())

    // The current message is already in the table (trigger fires AFTER INSERT),
    // so todayCount includes this message. Cap at 4.
    if ((todayCount || 0) > 4) {
      console.log(`Daily SMS cap reached (${todayCount} messages today) for family ${record.family_name}. Message saved, no SMS.`)
      return new Response(JSON.stringify({ skipped: true, reason: 'daily cap reached' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 3) Look up all OTHER family members with phone + sms_notifications enabled
    const { data: familyMembers } = await supabaseAdmin
      .from('user_profile')
      .select('phone, first_name, sms_notifications')
      .eq('invited_by', record.user_id)
      .not('phone', 'is', null)

    const eligibleMembers = (familyMembers || []).filter(
      m => m.phone && m.sms_notifications !== false
    )

    if (eligibleMembers.length === 0) {
      console.log('No eligible family members to notify.')
      return new Response(JSON.stringify({ skipped: true, reason: 'no recipients' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 4) Build SMS message
    const senderName = posterProfile.first_name || record.author_name || 'Your loved one'
    const msgText = (record.message_text || '').trim()

    let smsBody: string
    if (msgText.length > 0 && msgText.length <= 100) {
      smsBody = `${senderName} sent a message in SeniorSafe: "${msgText}" Reply STOP to opt out`
    } else if (msgText.length > 100) {
      smsBody = `${senderName} sent a message in SeniorSafe. Open the app to read it. Reply STOP to opt out`
    } else {
      // Photo-only message (no text)
      smsBody = `${senderName} shared something in SeniorSafe. Open the app to see it. Reply STOP to opt out`
    }

    // 5) Send SMS to each eligible member
    const results = await Promise.all(
      eligibleMembers.map(m => sendTwilioSMS(m.phone, smsBody))
    )

    const successCount = results.filter(Boolean).length
    console.log(`SMS sent: ${successCount}/${eligibleMembers.length} for family ${record.family_name}`)

    return new Response(JSON.stringify({
      success: true,
      sent: successCount,
      total: eligibleMembers.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('family-message-notify error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
