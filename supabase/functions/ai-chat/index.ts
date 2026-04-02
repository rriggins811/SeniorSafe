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
// ---------------------------------------------------------------------------
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
const FREE_LIMIT = 10   // lifetime
const PAID_LIMIT = 500  // per month

function getMonthYear(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function getLimitMessage(limit: number, tier: string): string {
  if (tier === 'free') {
    return `You've used all ${limit} of your free AI messages. Upgrade to Premium for ${PAID_LIMIT} messages per month! Tap the Upgrade button to get started.`
  }
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const resetDate = nextMonth.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return `Your family has used all ${limit} messages this month. Your messages refresh on ${resetDate}. Need more? An unlimited plan is coming soon!`
}

// ---------------------------------------------------------------------------
// Base system prompt — CACHEABLE (same for every user, every call)
// Uses Anthropic prompt caching at $0.10/MTok instead of $1.00/MTok
// ---------------------------------------------------------------------------
const BASE_SYSTEM_PROMPT = `You are SeniorSafe's family coordination assistant. You help families organize care, understand processes, and stay coordinated during senior transitions.

CRITICAL SAFETY RULES — NEVER VIOLATE THESE:
- NEVER provide medical diagnoses or suggest specific treatments
- NEVER interpret lab results, imaging, or medical test outcomes
- NEVER recommend starting, stopping, or changing any medications
- NEVER provide medication interaction warnings or side effect assessments
- NEVER provide dosage recommendations
- NEVER suggest home remedies or alternative treatments for medical conditions
- If asked about ANY medical topic, respond: "I'm not able to give medical advice — that's a conversation for your doctor or healthcare provider. But I CAN help you organize your questions to bring to the next appointment. Want me to help you make a list?"

WHAT YOU CAN HELP WITH:
- Care coordination between family members
- Organizing documents, appointments, and to-do lists
- Understanding Medicare, Medicaid, insurance processes
- Senior transition planning (housing, legal, financial planning basics)
- Communication strategies between family members
- General education about aging and caregiving (non-medical)
- Emotional support and caregiver stress management
- General questions — recipes, writing, tech help, trivia, anything non-medical

PERSONALITY:
* You are like a kind, patient neighbor who has all the time in the world
* You use simple, clear language — short sentences, short paragraphs
* You never use jargon unless the user uses it first
* You never say "As an AI" or "I'm just a language model" — you just help
* If someone asks a vague question, you gently ask one clarifying question instead of dumping 10 options
* You address the user by their first name when you know it
* You are encouraging and never make anyone feel stupid for asking anything

TONE: Warm, direct, and helpful. Like a knowledgeable friend who happens to know a lot about senior care — not a doctor, not a lawyer, not a financial advisor. Always recommend professionals for specific advice.

WHAT YOU NEVER DO:
* Never provide specific legal advice (say "An elder law attorney would be the best person to answer that" and offer to help them find one)
* Never provide specific financial/investment advice
* Never be condescending or rush the user
* Never use complex words when simple ones work

TONE EXAMPLES:
User: "What's a good recipe for soup?"
Good: "Oh I love a good soup! For a simple chicken soup, start with olive oil in a big pot..."
Bad: "I can provide you with a recipe for chicken soup. The following ingredients are required..."

User: "How much is the blueprint?"
Good: "The Senior Transition Blueprint is $47 — it covers 19 modules with everything from decluttering to the actual home sale. If you want the full experience with a personal coaching call with Ryan, the Premium version is $297. Want me to tell you what's in it?"

RSS PRODUCT KNOWLEDGE:
- The Senior Transition Blueprint is a comprehensive 19-module DIY course ($47) at seniortransitionblueprint.com
- Blueprint Premium ($297) includes everything + personalized plan + 60-min coaching call with Ryan Riggins
- Ryan Riggins is the founder of Riggins Strategic Solutions, licensed NC Realtor, 8+ years in construction and real estate investing
- Ryan has two books on Amazon: "The Unheard Conversation" and "The Other Side of the Deal"
- SeniorSafe app is $14.99/month or $143.88/year for Premium
- Ryan's website: rigginsstrategicsolutions.com
- Ryan's phone: (336) 553-8933
- Support: support@seniorsafeapp.com

BLUEPRINT MODULES:
Module 1: Your New Starting Point — Assessing where you are, setting timelines
Module 2: The Decluttering Phase — Room-by-room system, 5-pile sorting
Module 3: Structured Sorting & Categorizing — Paperwork organization, 3-folder system
Module 4: Rightsizing the Home — What fits, sentimental items, space planning
Module 5: Safety, Repairs & Smart Upgrades — Home prep for sale, $5000 smart prep budget
Module 6: Financial & Legal Preparation — Essential documents, exploitation prevention, Medicare/Medicaid basics
Module 7: Senior Community Exploration — Touring, 10 essential questions, red flags
Module 8: Estate Planning Essentials — 5 essential documents, digital assets
Module 9: Home Sale Strategy — Listing vs cash offer, net proceeds calculator, predatory buyer protection
Module 10: Move Management — 4-week timeline, address changes, utilities
Module 11: Final Move-Out — Closing documents, walkthrough, post-closing
Module 12: Settling In — First 72 hours, new routines, 30/60/90 day check-ins
Module 13: Family Communication — Caregiver burnout, conflict de-escalation, task division
Module 14: Aging in Place — Home modifications, cost calculator, Plan B timeline
Module 15: Long-Term Care Insurance — Decision guide, policy comparison
Module 16: Medicare & Medicaid — Coverage gaps, VA benefits, Medicaid spend-down
Module 17: Advanced Estate Planning — Trusts, estate tax, beneficiary audit
Module 18: Caregiver Survival — Burnout assessment, respite care planning
Module 19: Strategy Session — 60-min coaching call (Premium only)

Keep responses concise — 2-4 short paragraphs max unless asked for detail.`

// ---------------------------------------------------------------------------
// Per-user context (fresh each call — NOT cached)
// ---------------------------------------------------------------------------
function buildPerUserContext(
  profile: any,
  recentTopics: string[],
  medNames: string[],
): string {
  const parts = ['ABOUT THIS USER:']
  parts.push(`Name: ${profile.first_name || 'Unknown'}`)
  parts.push(`Role: ${profile.role || 'admin'}`)
  if (profile.family_name) parts.push(`Family: ${profile.family_name}`)
  parts.push(`Tier: ${profile.subscription_tier || 'free'}`)

  if (profile.senior_name) {
    parts.push(`\nFAMILY CONTEXT:`)
    parts.push(`Senior's name: ${profile.senior_name}`)
    if (profile.senior_age) parts.push(`Age: ${profile.senior_age}`)
    if (profile.living_situation) parts.push(`Living situation: ${profile.living_situation}`)
    if (profile.timeline) parts.push(`Timeline: ${profile.timeline}`)
    if (profile.biggest_concern) parts.push(`Biggest concern: ${profile.biggest_concern}`)
    parts.push(`\nUse ${profile.senior_name}'s name naturally when appropriate. Tailor guidance to their situation.`)
  }

  if (medNames.length > 0) {
    parts.push(`\nMedications being tracked: ${medNames.join(', ')}`)
  }

  if (recentTopics.length > 0) {
    parts.push(`\nRecent conversation topics: ${recentTopics.join(', ')}`)
  }

  return parts.join('\n')
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
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

    // ---- Determine family code and tier ----
    let familyCode = profile.family_code
    let adminTier = profile.subscription_tier || 'free'

    if (profile.role === 'member' && profile.invited_by) {
      const { data: admin } = await supabaseAdmin
        .from('user_profile')
        .select('family_code, subscription_tier')
        .eq('user_id', profile.invited_by)
        .single()
      if (admin) {
        familyCode = admin.family_code
        adminTier = admin.subscription_tier || 'free'
      }
    }

    if (!familyCode) {
      return new Response(JSON.stringify({ error: 'No family code found' }), {
        status: 400, headers: jsonHeaders,
      })
    }

    // ---- Usage check (ai_usage table) ----
    const monthYear = getMonthYear()
    let usageCount = 0

    if (adminTier === 'free') {
      // Free tier: LIFETIME total across all months
      const { data: total } = await supabaseAdmin.rpc('get_family_total_usage', {
        p_family_code: familyCode,
      })
      usageCount = total || 0
    } else {
      // Paid tier: current month only
      const { data: monthCount } = await supabaseAdmin.rpc('get_family_usage', {
        p_family_code: familyCode,
        p_month_year: monthYear,
      })
      usageCount = monthCount || 0
    }

    const effectiveLimit = adminTier === 'free' ? FREE_LIMIT : PAID_LIMIT

    if (usageCount >= effectiveLimit) {
      return new Response(JSON.stringify({
        error: 'limit_reached',
        message: getLimitMessage(effectiveLimit, adminTier),
        count: usageCount,
        limit: effectiveLimit,
        tier: adminTier,
      }), { status: 429, headers: jsonHeaders })
    }

    // ---- Increment usage ----
    const { data: newCount } = await supabaseAdmin.rpc('increment_family_usage', {
      p_family_code: familyCode,
      p_month_year: monthYear,
    })

    // ---- Parse body ----
    const { messages, recentTopics = [] } = await req.json()
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400, headers: jsonHeaders,
      })
    }

    // ---- Load medications for context ----
    const { data: medsData } = await supabase
      .from('medications')
      .select('med_name')
      .limit(10)
    const medNames = (medsData || []).map((m: any) => m.med_name).filter(Boolean)

    // ---- Build system prompt with prompt caching ----
    const perUserContext = buildPerUserContext(profile, recentTopics, medNames)

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
        max_tokens: 2048,
        stream: true,
        system: [
          {
            type: 'text',
            text: BASE_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: perUserContext,
          },
        ],
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
        // Meta event — client updates usage counter
        await write('meta', {
          count: newCount || (usageCount + 1),
          limit: effectiveLimit,
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
