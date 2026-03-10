import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

// ---------------------------------------------------------------------------
// Family member leaves the family group — unlinks from admin, notifies in-app
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

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // ---- Get member profile ----
    const { data: profile } = await supabase
      .from('user_profile')
      .select('role, invited_by, first_name, family_name')
      .eq('user_id', user.id)
      .single()

    if (!profile || profile.role !== 'member' || !profile.invited_by) {
      return new Response(
        JSON.stringify({ error: 'Only linked family members can leave a family' }),
        { status: 400, headers: cors }
      )
    }

    const adminId = profile.invited_by

    // ---- Get admin's family_name for the notification message ----
    const { data: adminProfile } = await supabase
      .from('user_profile')
      .select('family_name')
      .eq('user_id', adminId)
      .single()

    // ---- Unlink member ----
    await supabase
      .from('user_profile')
      .update({
        invited_by: null,
        subscription_tier: 'free',
        family_name: null,          // isolate from family RLS scope
      })
      .eq('user_id', user.id)

    // ---- Notify admin via in-app message (NOT SMS) ----
    const memberName = profile.first_name || 'A family member'
    await supabase.from('family_messages').insert({
      user_id: adminId,
      author_name: 'SeniorSafe',
      message_text: `${memberName} has left the family group.`,
      family_name: adminProfile?.family_name || null,
    })

    console.log(`✅ Member ${user.id} left family of admin ${adminId}`)

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors })
  } catch (err) {
    console.error('leave-family error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors })
  }
})
