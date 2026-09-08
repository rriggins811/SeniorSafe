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


serve(async (req) => {
  // This function is called internally by the Postgres trigger via pg_net.
  // No CORS needed (server-to-server). No JWT needed (deployed with --no-verify-jwt).

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 })
  }

  try {
    const { record } = await req.json()

    if (!record?.id) {
      console.log('Missing message id in payload, skipping.')
      return new Response(JSON.stringify({ skipped: true, reason: 'missing id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // SECURITY (audit #10): this endpoint has NO caller auth (it's a Postgres pg_net
    // trigger sink). Do NOT trust the POSTed record's user_id / family_name /
    // message_text  -  a forged POST could otherwise inject attacker text into another
    // family's SMS/push blast. Re-read the message from the DB by id; the real row is
    // the source of truth for the poster (hence the family) and the content. A forged
    // or unknown id finds no row and is skipped.
    const { data: msg } = await supabaseAdmin
      .from('family_messages')
      .select('id, user_id, family_name, author_name, message_text, created_at')
      .eq('id', record.id)
      .single()
    if (!msg?.user_id || !msg?.family_name) {
      console.log('Message not found (or forged id), skipping.')
      return new Response(JSON.stringify({ skipped: true, reason: 'message not found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const posterId: string = msg.user_id
    const familyName: string = msg.family_name
    const authorName: string | null = msg.author_name
    const messageText: string = msg.message_text || ''

    // Who posted, and which family is this? Any member's message notifies
    // the rest of the family (notifications are free; the old admin-only and
    // 4-a-day rules existed to cap text costs).
    const { data: posterProfile } = await supabaseAdmin
      .from('user_profile')
      .select('role, first_name, invited_by')
      .eq('user_id', posterId)
      .single()
    const familyRoot: string = posterProfile?.invited_by || posterId

    // 3) Look up all OTHER family members
    const { data: familyRows } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, first_name')
      .or(`user_id.eq.${familyRoot},invited_by.eq.${familyRoot}`)
    const familyMembers = (familyRows || []).filter(r => r.user_id !== posterId)

    if (!familyMembers?.length) {
      console.log('No family members to notify.')
      return new Response(JSON.stringify({ skipped: true, reason: 'no recipients' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Send push notifications to all members
    const senderName = posterProfile?.first_name || authorName || 'Your loved one'
    let delivered = 0
    const pushPreview = (messageText || '').trim().slice(0, 50)
    const pushBody = pushPreview || 'Shared something new'
    try {
      const pushRes = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_ids: familyMembers.map(m => m.user_id),
            title: 'New Message',
            body: `${senderName}: ${pushBody}`,
            notification_type: 'family_message',
            data: { route: '/family' },
          }),
        },
      )
      const pushJson = await pushRes.json().catch(() => null)
      delivered = (pushJson?.results || []).filter((r: { push: boolean }) => r.push).length
    } catch (pushErr) {
      console.error('Push notification error:', pushErr)
    }

    // 2026-09-08: family messages are notifications only. Texting every
    // relative for every chatty message was the single biggest cost in the
    // app. The push above (plus the unread badge in the app) is the delivery.
    return new Response(JSON.stringify({
      success: true,
      delivered,
      total: familyMembers.length,
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