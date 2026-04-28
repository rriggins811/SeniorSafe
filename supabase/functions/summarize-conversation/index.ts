// summarize-conversation: Phase 1.5 auto-summary loop.
// Triggered by the client when a conversation closes (user taps + New, or
// switches to a different conversation). Compacts the just-finished
// conversation into family_context.summary so that future sessions remember
// the family's situation without re-storing raw transcripts.
//
// HIPAA-honest design: specific medical details, medication names, and
// mental-health specifics are intentionally NOT extracted. The summary
// captures stage / phase / persona / decisions / milestones / emotional
// context, never lab values or prescription names.
//
// Idempotent: each conversation is summarized at most once (summarized_at
// stamp). Safe to call repeatedly.
//
// Handles both Maggie and SeniorSafe AI conversations via the `source` param.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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
  }
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const FAMILY_CONTEXT_TOKEN_CAP = 3000
function approxTokenCount(text: string): number { return Math.ceil(text.length / 4) }

function jsonResponse(body: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

const SUMMARIZER_SYSTEM_PROMPT = `You are a memory compactor for SeniorSafe families. Your job: given a finished conversation (transcript below) and the family's current running summary, produce an UPDATED running summary that captures what genuinely matters for future sessions.

What to capture (and update if already known):
- The senior's profile (age, current living situation, transition stage, readiness signals). NOT specific medical details, medication names, or mental-health specifics.
- Family structure (primary caregiver, siblings, who's doing what, known conflict).
- Blueprint progress (which tools mentioned/started/completed, which modules covered).
- Key decisions made ("family decided memory care by Q3," "selling as-is," "using MAPT strategy").
- Professional team (attorney, agent, care manager, names and roles only, no PII like phone/email).
- Upcoming milestones (attorney appointment, tour date, move date, closing date).
- Emotional context ("Dad is resistant," "sibling tension around the will," "Mom recently widowed").
- Detected Persona (Stoic, Denier, Overwhelmed, Grieving/Keeper of Memories, Controller).
- Any acute alerts that fired (falls, exploitation, crisis events). Reference once; don't dwell.

What to NEVER capture (HIPAA-honest):
- Specific medical diagnoses, lab values, medication names, dosages.
- Mental health specifics (medication names for depression, therapy notes, ideation transcripts).
- Financial account numbers, SSNs, passwords, addresses.
- Verbatim quotes from private conversations.

Format: Markdown bullet list under bold-headed sections. Compact, no fluff. The summary is loaded into every future Maggie/SeniorSafe AI session, so brevity matters. **Hard cap 2,800 tokens (~11,000 characters).** If you would exceed, drop oldest/least-relevant items first; preserve recent decisions, current stage, persona, and upcoming milestones.

Return ONLY the updated summary as the response body. No preamble like "Here is the summary." No closing remarks. Just the markdown.`

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing authorization' }, 401, corsHeaders)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)

    const body = await req.json().catch(() => ({}))
    const { conversation_id, source } = body
    if (!conversation_id || !source || !['maggie', 'senior_safe'].includes(source)) {
      return jsonResponse({ error: 'conversation_id and source (maggie|senior_safe) required' }, 400, corsHeaders)
    }

    const convTable = source === 'maggie' ? 'maggie_conversations' : 'ai_conversations'
    const msgTable = source === 'maggie' ? 'maggie_messages' : 'ai_messages'

    const { data: conv, error: convErr } = await supabaseAdmin
      .from(convTable)
      .select('id, user_id, family_code, title, summarized_at')
      .eq('id', conversation_id)
      .single()
    if (convErr || !conv) return jsonResponse({ error: 'Conversation not found' }, 404, corsHeaders)
    if (conv.user_id !== user.id) return jsonResponse({ error: 'Not your conversation' }, 403, corsHeaders)
    if (conv.summarized_at) {
      return jsonResponse({ status: 'already_summarized', summarized_at: conv.summarized_at }, 200, corsHeaders)
    }

    let familyCode: string | null = conv.family_code
    if (!familyCode) {
      const { data: profile } = await supabaseAdmin
        .from('user_profile')
        .select('family_code, role, invited_by')
        .eq('user_id', user.id)
        .single()
      familyCode = profile?.family_code
      if (!familyCode && profile?.role === 'member' && profile?.invited_by) {
        const { data: admin } = await supabaseAdmin
          .from('user_profile')
          .select('family_code')
          .eq('user_id', profile.invited_by)
          .single()
        familyCode = admin?.family_code || null
      }
    }
    if (!familyCode) return jsonResponse({ error: 'No family_code' }, 400, corsHeaders)

    const { data: msgs, error: msgErr } = await supabaseAdmin
      .from(msgTable)
      .select('role, content, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true })
    if (msgErr) return jsonResponse({ error: `messages fetch failed: ${msgErr.message}` }, 500, corsHeaders)
    if (!msgs || msgs.length === 0) {
      await supabaseAdmin.from(convTable).update({ summarized_at: new Date().toISOString() }).eq('id', conversation_id)
      return jsonResponse({ status: 'empty_conversation' }, 200, corsHeaders)
    }

    const { data: ctxRow } = await supabaseAdmin
      .from('family_context')
      .select('summary')
      .eq('family_code', familyCode)
      .maybeSingle()
    const existingSummary = ctxRow?.summary || ''

    const transcript = msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
    const userPrompt =
      `## Current running summary\n\n${existingSummary || '(none yet, this is the first conversation being summarized for this family)'}\n\n` +
      `## Conversation that just finished (source: ${source})\n\n${transcript}\n\n` +
      `## Your task\n\nProduce the UPDATED running summary. Merge new information into the existing structure. Drop stale/superseded items. Keep under 2,800 tokens. Markdown only, no preamble.`

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500, corsHeaders)

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3500,
        system: SUMMARIZER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}))
      return jsonResponse({
        error: (errBody as any)?.error?.message || `Anthropic error ${anthropicRes.status}`,
      }, 502, corsHeaders)
    }

    const result = await anthropicRes.json()
    const newSummary: string = result.content?.[0]?.text || ''
    if (!newSummary || newSummary.trim().length === 0) {
      return jsonResponse({ error: 'Empty summary returned by model' }, 502, corsHeaders)
    }

    const capped = approxTokenCount(newSummary) > FAMILY_CONTEXT_TOKEN_CAP
      ? newSummary.slice(0, FAMILY_CONTEXT_TOKEN_CAP * 4)
      : newSummary

    const tokenCount = approxTokenCount(capped)
    const now = new Date().toISOString()

    await supabaseAdmin
      .from('family_context')
      .upsert({
        family_code: familyCode,
        summary: capped,
        token_count: tokenCount,
        last_summarized_at: now,
        updated_at: now,
      })

    await supabaseAdmin
      .from(convTable)
      .update({ summarized_at: now })
      .eq('id', conversation_id)

    return jsonResponse({
      status: 'summarized',
      family_code: familyCode,
      token_count: tokenCount,
      summarized_at: now,
    }, 200, corsHeaders)
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500, corsHeaders)
  }
})
