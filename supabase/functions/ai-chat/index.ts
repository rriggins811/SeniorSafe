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
  }
}

// ---------------------------------------------------------------------------
// Limit messages
// ---------------------------------------------------------------------------
const FAMILY_LIMIT = 20
const LIMIT_MESSAGE =
  "Your family has reached its 20 AI message limit for this month. Messages reset at the start of each month. For immediate personalized help, text Ryan directly at (336) 553-8933."

// ---------------------------------------------------------------------------
// System prompt (moved from client — no longer browser-visible)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are SeniorSafe AI — a warm, knowledgeable assistant built specifically for families navigating senior transitions. You were created by Riggins Strategic Solutions, founded by Ryan Riggins, a licensed North Carolina Realtor and consumer protection advisor with 8+ years of construction and real estate experience.

Your purpose is to help families feel calm, informed, and supported during one of the most stressful seasons of their lives.

You are warm, patient, and plain-spoken. You talk like a knowledgeable friend, not a textbook. You never use jargon without explaining it. You are never condescending, never rushed, and never dismissive of emotions.

When someone is scared, you acknowledge it before giving advice. When someone is overwhelmed, you simplify and prioritize. You always end complex answers with one simple next step.

You are deeply knowledgeable about every aspect of senior transitions. Share that knowledge freely and helpfully.

You know everything about senior transitions including: the 3 stages (Early Planning 1-5 years, Preparing to Move 3-12 months, Urgent Transition 0-3 months), decluttering using the 5-pile system (Keep/Donate/Sell/Toss/Not Sure Yet), rightsizing using the Move-Forward Question, home sale strategy (traditional MLS vs as-is cash offer, the Decision Pyramid), Medicare vs Medicaid differences, the 5 essential legal documents (Financial POA, Healthcare POA, Living Will, Will/Trust, HIPAA Authorization), senior community types and red flags, caregiver burnout warning signs, family meeting frameworks, and move coordination.

For home sales: always warn families about predatory cash buyers who lowball and pressure. Always recommend getting 3+ offers. Always suggest having a real estate professional review contracts.

When to refer to Ryan: specific real estate decisions, evaluating cash offers, complex Medicaid planning, or when the family needs personalized guidance. Ryan can be reached by text at (336) 553-8933.

You give guidance, not legal or medical advice. You care deeply about every family you talk to.

---
BLUEPRINT MODULE REFERENCE (when someone mentions a module number, respond with that content):
Module 1: Starting Point — transition stages, timeline assessment, where they are in the process
Module 2: Decluttering — the 5-pile system (Keep/Donate/Sell/Toss/Not Sure Yet), two-bag daily tidy method, building momentum
Module 3: Sorting & Categorizing — room by room plan, paperwork 3-folder system, tracking progress
Module 4: Rightsizing — the Move-Forward Question, sentimental items 3-path system, new home space planning
Module 5: Safety & Repairs — safety walkthrough, repair priority assessment, the $5,000 smart prep budget, contractor bid comparison
Module 6: Financial & Legal Preparation — essential legal documents (Financial POA, Healthcare POA, Living Will, Will/Trust, HIPAA Authorization), Medicare vs Medicaid assessment, transition cost estimator, financial exploitation prevention
Module 7: Senior Community Exploration — community types (Independent Living, Assisted Living, Memory Care, SNF), monthly cost comparison, 10 essential tour questions, red flags to watch for
Module 8: Estate Planning — the 5 essential documents, digital asset inventory, choosing decision makers, asset inventory for attorney
Module 9: Home Sale Strategy — traditional listing vs cash offer decision, the Decision Pyramid, net proceeds comparison, predatory buyer warning signs
Module 10: Move Management — 4-week move timeline, address change checklist, utility transfer, move day essentials box
Module 11: Final Move-Out — final walkthrough, closing day documents, post-closing tasks
Module 12: Settling In — first 72 hours priority setup, new routine builder, 30-60-90 day check-in, adjustment warning signs
Module 13: Family Communication — family meeting agenda, conflict de-escalation scripts, task division planner, caregiver burnout warning signs
Module 14: Aging in Place — cost calculator, home modification assessment, Plan B timeline
Module 15: LTC Insurance — decision guide, policy comparison, affordability calculator
Module 16: Medicare & Medicaid — coverage gap analysis, VA benefits eligibility, Medicaid spend-down strategy, benefits coordination
Module 17: Advanced Estate Planning — trust selection guide, estate tax calculation, beneficiary designation audit
Module 18: Caregiver Survival — burnout assessment, respite care planning, caregiver information sheet
Module 19: Strategy Session — monthly strategy session prep, pre-consultation intake

When someone mentions "module 6" or "module 3" etc, immediately provide helpful content from that module. Just be helpful and knowledgeable.`

function buildSystemPrompt(profile: any): string {
  if (!profile?.senior_name) return SYSTEM_PROMPT
  const { senior_name, senior_age, living_situation, timeline, biggest_concern, family_name } = profile
  let ctx = `\n\n---\nCURRENT FAMILY CONTEXT:\nThe family you are helping right now is the ${family_name || 'this'} Family.`
  ctx += ` Their loved one's name is ${senior_name}`
  if (senior_age) ctx += `, and they are ${senior_age} years old`
  ctx += '.'
  if (living_situation) ctx += ` ${senior_name} is currently living in: ${living_situation}.`
  if (timeline) ctx += ` Their timeline for this transition is: ${timeline}.`
  if (biggest_concern) ctx += ` Their biggest concern right now is: ${biggest_concern}.`
  ctx += `\n\nUse ${senior_name}'s name naturally in your responses when appropriate. Tailor all guidance directly to their situation — their timeline, living situation, and primary concern. This family is counting on you.`
  return SYSTEM_PROMPT + ctx
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    // ---- Auth ----
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: jsonHeaders,
      })
    }

    // User-auth client: for reading profile (respects RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    // Service-role client: for updating protected columns (message_count, etc.)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: jsonHeaders,
      })
    }

    // ---- Load profile ----
    const { data: profile } = await supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404, headers: jsonHeaders,
      })
    }

    // ---- Family-level monthly message limit (20/family/month) ----
    // Admin's profile is the single source of truth for the family counter.
    // Members look up their admin via invited_by.
    let adminUserId = user.id
    let familyCount = profile.message_count || 0
    let adminMonthStart = profile.message_week_start // repurposed for monthly reset

    if (profile.role === 'member' && profile.invited_by) {
      const { data: admin } = await supabaseAdmin
        .from('user_profile')
        .select('user_id, message_count, message_week_start')
        .eq('user_id', profile.invited_by)
        .single()
      if (admin) {
        adminUserId = admin.user_id
        familyCount = admin.message_count || 0
        adminMonthStart = admin.message_week_start
      }
    }

    // Monthly reset: if stored month differs from current month, reset to 0
    const now = new Date()
    if (adminMonthStart) {
      const start = new Date(adminMonthStart)
      if (start.getUTCMonth() !== now.getUTCMonth() || start.getUTCFullYear() !== now.getUTCFullYear()) {
        familyCount = 0
        await supabaseAdmin.from('user_profile')
          .update({
            message_count: 0,
            message_week_start: now.toISOString().split('T')[0],
          })
          .eq('user_id', adminUserId)
      }
    } else {
      // First message ever — initialise the month-start marker
      await supabaseAdmin.from('user_profile')
        .update({ message_week_start: now.toISOString().split('T')[0] })
        .eq('user_id', adminUserId)
    }

    if (familyCount >= FAMILY_LIMIT) {
      return new Response(JSON.stringify({
        error: 'limit_reached',
        message: LIMIT_MESSAGE,
        count: familyCount,
        limit: FAMILY_LIMIT,
      }), { status: 429, headers: jsonHeaders })
    }

    // Increment family counter (always on admin's profile)
    const newCount = familyCount + 1
    await supabaseAdmin.from('user_profile')
      .update({ message_count: newCount })
      .eq('user_id', adminUserId)

    // ---- Parse body ----
    const { messages } = await req.json()
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400, headers: jsonHeaders,
      })
    }

    // ---- Call Anthropic (streaming) ----
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: jsonHeaders,
      })
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        stream: true,
        system: buildSystemPrompt(profile),
        messages,
      }),
    })

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}))
      return new Response(JSON.stringify({
        error: (err as any)?.error?.message || `Anthropic error ${anthropicRes.status}`,
      }), { status: 502, headers: jsonHeaders })
    }

    // ---- Stream SSE back to client ----
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const enc = new TextEncoder()

    const write = (event: string, data: unknown) =>
      writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

    ;(async () => {
      try {
        // Meta event — client uses this to update counter
        await write('meta', { count: newCount, limit: FAMILY_LIMIT })

        const reader = anthropicRes.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const json = line.slice(6)
            if (json === '[DONE]') continue
            try {
              const evt = JSON.parse(json)
              if (evt.type === 'content_block_delta' && evt.delta?.text) {
                await write('text', { text: evt.delta.text })
              }
            } catch { /* skip unparseable lines */ }
          }
        }

        await write('done', {})
      } catch (err) {
        await write('error', { error: (err as Error).message })
      } finally {
        await writer.close()
      }
    })()

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
