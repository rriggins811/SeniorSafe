import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno"

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'http://localhost:5173',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

// ---------------------------------------------------------------------------
// Full account deletion — cancels Stripe, notifies family, deletes all data
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // ---- Auth: get calling user ----
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
    }

    // Service-role client for admin operations
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // ---- Get profile ----
    const { data: profile } = await supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: cors })
    }

    // ---- 1. Cancel Stripe subscription ----
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (stripeKey && profile.stripe_subscription_id) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
        await stripe.subscriptions.cancel(profile.stripe_subscription_id)
        console.log(`✅ Cancelled Stripe subscription ${profile.stripe_subscription_id}`)
      } catch (stripeErr) {
        console.error('Stripe cancel error (continuing):', stripeErr.message)
      }
    }

    // ---- 2. If admin → notify family via SMS + unlink them ----
    if (profile.role === 'admin') {
      const { data: members } = await supabase
        .from('user_profile')
        .select('user_id, phone, first_name')
        .eq('invited_by', user.id)

      if (members?.length) {
        const seniorName = profile.senior_name || profile.first_name || 'Your loved one'

        // SMS notification
        const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
        const AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')
        const FROM_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')

        if (ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER) {
          const credentials = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)

          for (const member of members) {
            if (member.phone) {
              try {
                const toPhone = normalizePhone(member.phone)
                const body = new URLSearchParams({
                  To: toPhone,
                  From: FROM_NUMBER,
                  Body: `${seniorName}'s SeniorSafe account has been closed. You can still sign in but family features will be unavailable. — SeniorSafe. Reply STOP to opt out`,
                })
                await fetch(
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
                console.log(`📱 Notified ${member.first_name} about account deletion`)
              } catch (smsErr) {
                console.error(`SMS error for ${member.first_name}:`, smsErr)
              }
            }
          }
        }

        // Unlink family members → set free tier, clear invited_by
        for (const member of members) {
          await supabase
            .from('user_profile')
            .update({ invited_by: null, subscription_tier: 'free' })
            .eq('user_id', member.user_id)
        }
        console.log(`✅ Unlinked ${members.length} family member(s)`)
      }
    }

    // If member → notify admin via in-app message
    if (profile.role === 'member' && profile.invited_by) {
      const { data: adminProfile } = await supabase
        .from('user_profile')
        .select('family_name')
        .eq('user_id', profile.invited_by)
        .single()

      const memberName = profile.first_name || 'A family member'
      await supabase.from('family_messages').insert({
        user_id: profile.invited_by,
        author_name: 'SeniorSafe',
        message_text: `${memberName} has deleted their account and left the family.`,
        family_name: adminProfile?.family_name || null,
      })
    }

    // ---- 3. Delete related data (order matters for FK constraints) ----
    // Get medication IDs for dependent tables
    const { data: meds } = await supabase
      .from('medications')
      .select('id')
      .eq('user_id', user.id)

    if (meds?.length) {
      const medIds = meds.map((m: { id: string }) => m.id)
      await supabase.from('med_logs').delete().in('medication_id', medIds)
      await supabase.from('reminder_logs').delete().in('medication_id', medIds)
    }

    // Delete all user data
    await supabase.from('medications').delete().eq('user_id', user.id)
    await supabase.from('checkins').delete().eq('user_id', user.id)
    await supabase.from('appointments').delete().eq('user_id', user.id)
    await supabase.from('family_messages').delete().eq('user_id', user.id)
    await supabase.from('family_photos').delete().eq('uploaded_by', user.id)
    await supabase.from('documents').delete().eq('user_id', user.id)
    await supabase.from('emergency_info').delete().eq('user_id', user.id)
    await supabase.from('quick_dial_contacts').delete().eq('user_id', user.id)
    await supabase.from('checkin_alert_logs').delete().eq('admin_id', user.id)

    // Nudge logs (may not exist — safe to try)
    try { await supabase.from('nudge_logs').delete().eq('admin_id', user.id) } catch { /* ignore */ }
    try { await supabase.from('nudge_logs').delete().eq('member_id', user.id) } catch { /* ignore */ }

    // ---- 4. Delete storage files ----
    try {
      const { data: files } = await supabase.storage.from('Documents').list(user.id)
      if (files?.length) {
        const paths = files.map((f: { name: string }) => `${user.id}/${f.name}`)
        await supabase.storage.from('Documents').remove(paths)
      }
      // Subfolder: family-photos
      const { data: photoFiles } = await supabase.storage.from('Documents').list(`${user.id}/family-photos`)
      if (photoFiles?.length) {
        const photoPaths = photoFiles.map((f: { name: string }) => `${user.id}/family-photos/${f.name}`)
        await supabase.storage.from('Documents').remove(photoPaths)
      }
    } catch (storageErr) {
      console.error('Storage cleanup error (continuing):', storageErr)
    }

    // ---- 5. Delete user_profile ----
    await supabase.from('user_profile').delete().eq('user_id', user.id)

    // ---- 6. Delete auth user ----
    const { error: deleteAuthErr } = await supabase.auth.admin.deleteUser(user.id)
    if (deleteAuthErr) {
      console.error('Auth deletion error:', deleteAuthErr.message)
    }

    console.log(`✅ Account fully deleted: ${user.id}`)

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors })
  } catch (err) {
    console.error('delete-account error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors })
  }
})
