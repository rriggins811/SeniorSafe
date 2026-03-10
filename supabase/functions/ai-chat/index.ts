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
// Module-scope admin client (service role — bypasses RLS)
// Created once at module level with proper serverless options
// ---------------------------------------------------------------------------
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ---------------------------------------------------------------------------
// Limit messages — tier-aware
// ---------------------------------------------------------------------------
const FREE_LIMIT = 10
const PAID_LIMIT = 2000

function getLimitMessage(limit: number): string {
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const resetDate = nextMonth.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return `You've used all ${limit.toLocaleString()} of your AI messages for this month. Your messages will refresh on ${resetDate}. For help, contact support@seniorsafeapp.com.`
}

// ---------------------------------------------------------------------------
// System prompt (moved from client — no longer browser-visible)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the SeniorSafe AI assistant — a warm, friendly, knowledgeable companion. Think of yourself as a helpful neighbor who happens to know a lot about everything.

PERSONALITY:
- Warm, conversational, occasionally funny
- Talk like a real person, not a customer service bot
- Use short paragraphs, not walls of text
- Be genuinely helpful with ANY topic — recipes, weather questions, life advice, trivia, jokes, health questions, travel tips, anything
- Never say "that's outside my wheelhouse" or "I can't help with that"
- For local searches (find a store, find a doctor), give one helpful suggestion (try Google Maps, call your local senior center, etc.) then move on naturally — no lectures

SENIOR TRANSITION EXPERTISE:
You have deep knowledge of senior housing transitions including decluttering, home preparation, choosing senior communities, estate planning, Medicare/Medicaid, caregiver support, home sale strategies, and protection from predatory buyers/wholesalers. When these topics come up, go deep — this is your specialty.

RSS PRODUCT KNOWLEDGE:
- The Senior Transition Blueprint is a comprehensive 19-module DIY course covering every aspect of the senior transition. It costs $47 and is available at seniortransitionblueprint.com
- The Blueprint Premium ($297) includes everything in the core Blueprint PLUS a personalized transition plan and a 60-minute coaching call with Ryan Riggins
- Ryan Riggins is the founder of Riggins Strategic Solutions, a licensed NC Realtor with 8+ years in construction and real estate investing who now protects families from predatory practices
- Ryan has two books on Amazon: "The Unheard Conversation" and "The Other Side of the Deal"
- The SeniorSafe app (this app) is $14.99/month or $143.88/year for Premium
- Ryan's website: rigginsstrategicsolutions.com
- Ryan's phone: (336) 553-8933
- Support email: support@seniorsafeapp.com
When users ask about pricing, services, or the Blueprint, give them the specific details above. Don't say "I'm not sure" about RSS products — you know this information.

TONE EXAMPLES:
User: "What's a good recipe for soup?"
Good: "Oh I love a good soup! For a simple chicken soup, start with olive oil in a big pot..."
Bad: "I can provide you with a recipe for chicken soup. The following ingredients are required..."

User: "How much is the blueprint?"
Good: "The Senior Transition Blueprint is $47 — it covers 19 modules with everything from decluttering to the actual home sale. If you want the full experience with a personal coaching call with Ryan, the Premium version is $297. Want me to tell you what's in it?"
Bad: "I'm not sure of the exact pricing. You can contact Ryan for more information."

Keep responses concise — 2-4 short paragraphs max unless the user asks for detail. Always end with a natural follow-up question or offer to go deeper, but don't force it.

---
BLUEPRINT MODULE DETAILS (when someone asks about a module, give them the name and a helpful summary):
Module 1: Your New Starting Point — Assessing where you are in the transition, setting realistic timelines
Module 2: The Decluttering Phase — Room-by-room decluttering system, the 5-pile sorting method
Module 3: Structured Sorting & Categorizing — Paperwork organization, 3-folder system, tracking progress
Module 4: Rightsizing the Home — Deciding what fits in the new space, sentimental items, space planning
Module 5: Safety, Repairs & Smart Upgrades — Home prep for sale, $5000 smart prep budget, contractor comparison, what repairs actually matter
Module 6: Financial & Legal Preparation — Essential legal documents, financial exploitation prevention, transition cost estimating, Medicare/Medicaid basics
Module 7: Senior Community Exploration — Touring communities, 10 essential questions to ask, red flags to watch for, monthly cost comparison
Module 8: Estate Planning Essentials — The 5 essential documents, digital asset inventory, choosing decision makers
Module 9: Home Sale Strategy — Traditional listing vs cash offer comparison, net proceeds calculator, protection from predatory buyers and wholesalers
Module 10: Move Management & Coordination — 4-week move timeline, address changes, utility transfers, essentials box
Module 11: Final Move-Out & Home Transition — Closing day documents, final walkthrough, post-closing tasks
Module 12: Settling Into the Next Chapter — First 72 hours setup, new routine building, 30/60/90 day check-ins, adjustment warning signs
Module 13: Family Communication & Reducing Stress — Caregiver burnout signs, conflict de-escalation, family meeting planning, task division
Module 14: Aging in Place — Home modification assessment, cost calculator, Plan B timeline
Module 15: Long-Term Care Insurance — Decision guide, policy comparison, affordability calculator
Module 16: Medicare & Medicaid — Coverage gap analysis, VA benefits eligibility, Medicaid spend-down strategy
Module 17: Advanced Estate Planning — Trust selection, estate tax calculations, beneficiary audit
Module 18: Caregiver Survival — Burnout assessment, respite care planning, caregiver information sheet
Module 19: Strategy Session — One 60-minute coaching call with Ryan (included in Premium Blueprint only)

When someone asks about a specific module, give them the module name and a helpful summary of what it covers. If they want to purchase the Blueprint, direct them to seniortransitionblueprint.com ($47 for all 19 modules).`

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

    // supabaseAdmin is module-scope (see top of file)

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

    // ---- Family-level message limit (tier-aware) ----
    // Admin's profile is the single source of truth for the family counter.
    // Members look up their admin via invited_by.
    // Free tier: 10 messages/month | Paid tier: unlimited
    let adminUserId = user.id
    let familyCount = profile.message_count || 0
    let adminMonthStart = profile.message_week_start // repurposed for monthly reset
    let adminTier = profile.subscription_tier || 'free'

    if (profile.role === 'member' && profile.invited_by) {
      const { data: admin } = await supabaseAdmin
        .from('user_profile')
        .select('user_id, message_count, message_week_start, subscription_tier')
        .eq('user_id', profile.invited_by)
        .single()
      if (admin) {
        adminUserId = admin.user_id
        familyCount = admin.message_count || 0
        adminMonthStart = admin.message_week_start
        adminTier = admin.subscription_tier || 'free'
      }
    }

    // Monthly reset: if stored month differs from current month, reset to 0
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    if (adminMonthStart) {
      const start = new Date(adminMonthStart)
      if (start.getUTCMonth() !== now.getUTCMonth() || start.getUTCFullYear() !== now.getUTCFullYear()) {
        familyCount = 0
        const { error: resetErr } = await supabaseAdmin.from('user_profile')
          .update({ message_count: 0, message_week_start: todayStr })
          .eq('user_id', adminUserId)
        if (resetErr) console.error('[ai-chat] Monthly reset failed:', resetErr.message)
      }
    } else {
      // First message ever — initialise the month-start marker
      const { error: initErr } = await supabaseAdmin.from('user_profile')
        .update({ message_week_start: todayStr })
        .eq('user_id', adminUserId)
      if (initErr) console.error('[ai-chat] Init month-start failed:', initErr.message)
    }

    // Enforce tier-aware limits
    const effectiveLimit = adminTier === 'free' ? FREE_LIMIT : PAID_LIMIT
    if (familyCount >= effectiveLimit) {
      return new Response(JSON.stringify({
        error: 'limit_reached',
        message: getLimitMessage(effectiveLimit),
        count: familyCount,
        limit: effectiveLimit,
        tier: adminTier,
      }), { status: 429, headers: jsonHeaders })
    }

    // Increment family counter (always on admin's profile)
    const newCount = familyCount + 1
    const { error: incErr } = await supabaseAdmin.from('user_profile')
      .update({ message_count: newCount, message_week_start: todayStr })
      .eq('user_id', adminUserId)
    if (incErr) console.error('[ai-chat] Increment message_count failed:', incErr.message, '| adminUserId:', adminUserId, '| newCount:', newCount)

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
        await write('meta', {
          count: newCount,
          limit: adminTier === 'free' ? FREE_LIMIT : PAID_LIMIT,
          tier: adminTier,
        })

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
