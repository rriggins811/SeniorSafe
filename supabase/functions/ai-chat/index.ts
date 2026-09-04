import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  isConsolidationEnabledFor,
  normalizeTier,
  currentMonth,
  resetDateLabel,
  loadOrCreateBudget,
  logCall,
  isOverCap,
  buildUsageMetadata,
  ssAIDollarsSpent,
  maggieDollarsSpent,
  type BudgetRow,
  type TierKey,
} from '../_shared/budgets.ts'

const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'http://localhost:5173',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
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

const FREE_LIMIT = 10
const PAID_LIMIT = 500

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

const BASE_SYSTEM_PROMPT = `You are SeniorSafe AI, a simple everyday helper for an older adult using the SeniorSafe app.

WHO YOU ARE:
- A kind, patient neighbor who has time to talk
- Simple words. Short sentences. Short paragraphs.
- Use the person's first name when you know it
- Never say "as an AI" or "I'm just a language model"
- Never make anyone feel silly for asking
- Never rush them

WHAT YOU HELP WITH — this is the whole job:
- Recipes and cooking
- Everyday how-tos (writing a birthday card, using a phone setting, packing a bag for an appointment)
- Light conversation, jokes, trivia, memories
- General non-legal, non-medical questions
- Weather: you do NOT have live weather. Tell them to open the Weather app on their phone or ask Google for their city.

CRITICAL SAFETY — NEVER VIOLATE:
- NEVER diagnose, interpret labs, or suggest treatments
- NEVER recommend starting, stopping, or changing medications, dosages, or supplements
- NEVER give medication interaction or side-effect advice
- NEVER suggest home remedies for medical conditions
- If asked anything medical: "I'm not able to give medical advice — that's for your doctor. If this is an emergency, tap I Need Help on your home screen or call 911."
- If they describe an emergency (chest pain, can't breathe, stroke, fall and can't get up, heavy bleeding, suicide): tell them to call 911 or tap I Need Help right now. Do not keep chatting.

LEGAL, MONEY, AND MOVING ARE OFF LIMITS:
You do not answer — not even a "quick overview" — on:
- Wills, trusts, probate, power of attorney, guardianship, contracts
- Medicaid, Medicare strategy, spend-down, look-back, VA benefits planning
- Estates, inheritance, who gets the house
- Assisted living, memory care, CCRC, nursing homes, selling the house, cash buyers, or whether they should move
- Investments, taxes, or financial advice
- The Senior Transition Blueprint (that is Maggie's job for their adult children)

WHEN THE QUESTION IS NOT GENERAL:
Warmly redirect and stop. Do not summarize the topic anyway.
Say something like: "That's not something I can help with. For legal, money, or moving questions, ask your family or look it up on Google. Your family has a helper named Maggie for those. I can help with recipes, cards, or everyday how-tos — want one of those?"

TONE EXAMPLES:
User: "What's a good recipe for soup?"
Good: "A simple chicken soup: warm olive oil in a big pot. Cook chopped onion, carrot, and celery until soft. Add chicken broth and shredded chicken, a little salt and pepper. Simmer about 20 minutes. Add egg noodles at the end if you like."

User: "What's the weather today?"
Good: "I can't see live weather from here. Open the Weather app on your phone, or ask Google for your city."

User: "How do I get on Medicaid?" or "Should I get a trust?" or "Is assisted living a good idea?"
Good: "That's not something I can help with. Ask your family, or look it up on Google. They have Maggie in the app for questions like that. I can help with recipes, cards, or everyday how-tos — want one of those?"

Keep answers short: 2–4 short paragraphs unless they ask for more.`


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
    parts.push(`\nThe senior in this family is named ${profile.senior_name}.`)
    parts.push(`Do not give transition, legal, Medicaid, or housing advice. Redirect those.`)
  }

  if (medNames.length > 0) {
    parts.push(`\nMedications being tracked: ${medNames.join(', ')}`)
  }

  if (recentTopics.length > 0) {
    parts.push(`\nRecent conversation topics: ${recentTopics.join(', ')}`)
  }

  return parts.join('\n')
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: jsonHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
    }

    const { data: profile } = await supabase.from('user_profile').select('*').eq('user_id', user.id).single()
    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: jsonHeaders })
    }

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
      return new Response(JSON.stringify({ error: 'No family code found' }), { status: 400, headers: jsonHeaders })
    }

    console.log('[AI-CHAT-CALL]', {
      user_id:    user.id,
      tier:       adminTier,
      user_agent: req.headers.get('User-Agent') || 'unknown',
      ts:         new Date().toISOString(),
    })

    const flagOn = isConsolidationEnabledFor(user.id)
    let budgetRow:   BudgetRow | null = null
    let budgetMonth: string    | null = null
    let tierKey:     TierKey   | null = null

    if (flagOn) {
      tierKey = normalizeTier(adminTier)
      if (tierKey) {
        budgetMonth = currentMonth()
        try {
          budgetRow = await loadOrCreateBudget(supabaseAdmin, familyCode, tierKey, budgetMonth)
        } catch (err) {
          console.error('[AI-CHAT-BUDGET-LOAD-FAIL]', { user_id: user.id, family_code: familyCode, err })
        }

        if (budgetRow && isOverCap('ai', tierKey, budgetRow)) {
          const meta = buildUsageMetadata('ai', tierKey, budgetRow)
          return new Response(JSON.stringify({
            error: 'BUDGET_EXCEEDED',
            message: `You've used 100% of your monthly SeniorSafe AI budget. Resets ${resetDateLabel()}.`,
            reset_date:    resetDateLabel(),
            current_tier:  tierKey,
            upgrade_url:   tierKey === 'premium_plus' ? null : '/upgrade',
            _usage_metadata: meta,
          }), { status: 429, headers: jsonHeaders })
        }
      }
    }

    const monthYear = getMonthYear()
    let usageCount = 0

    if (adminTier === 'free') {
      const { data: total } = await supabaseAdmin.rpc('get_family_total_usage', { p_family_code: familyCode })
      usageCount = total || 0
    } else {
      const { data: monthCount } = await supabaseAdmin.rpc('get_family_usage', { p_family_code: familyCode, p_month_year: monthYear })
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

    const { data: newCount } = await supabaseAdmin.rpc('increment_family_usage', { p_family_code: familyCode, p_month_year: monthYear })

    const { messages, recentTopics = [] } = await req.json()
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), { status: 400, headers: jsonHeaders })
    }

    const { data: medsData } = await supabase.from('medications').select('med_name').limit(10)
    const medNames = (medsData || []).map((m: any) => m.med_name).filter(Boolean)

    const perUserContext = buildPerUserContext(profile, recentTopics, medNames)

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: jsonHeaders })
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
          { type: 'text', text: BASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: perUserContext },
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

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const enc = new TextEncoder()

    const write = (event: string, data: unknown) =>
      writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

    let inputTokens       = 0
    let outputTokens      = 0
    let cacheReadTokens   = 0
    let cacheCreateTokens = 0

    ;(async () => {
      try {
        await write('meta', { count: newCount || (usageCount + 1), limit: effectiveLimit, tier: adminTier })

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

              if (evt.type === 'message_start' && evt.message?.usage) {
                const u = evt.message.usage
                inputTokens       = u.input_tokens || 0
                cacheReadTokens   = u.cache_read_input_tokens || 0
                cacheCreateTokens = u.cache_creation_input_tokens || 0
              }
              if (evt.type === 'message_delta' && evt.usage?.output_tokens != null) {
                outputTokens = evt.usage.output_tokens
              }

              if (evt.type === 'content_block_delta' && evt.delta?.text) {
                await write('text', { text: evt.delta.text })
              }
            } catch { /* skip unparseable lines */ }
          }
        }

        if (flagOn && budgetRow && tierKey) {
          try {
            const synthRow: BudgetRow = {
              ...budgetRow,
              haiku_input_tokens:          Number(budgetRow.haiku_input_tokens)          + inputTokens,
              haiku_output_tokens:         Number(budgetRow.haiku_output_tokens)         + outputTokens,
              haiku_cache_read_tokens:     Number(budgetRow.haiku_cache_read_tokens)     + cacheReadTokens,
              haiku_cache_creation_tokens: Number(budgetRow.haiku_cache_creation_tokens) + cacheCreateTokens,
            }
            if (tierKey === 'trial') {
              synthRow.total_dollars_spent = ssAIDollarsSpent(synthRow) + maggieDollarsSpent(synthRow)
            }
            await write('usage_metadata', buildUsageMetadata('ai', tierKey, synthRow))
          } catch (err) {
            console.error('[AI-CHAT-METADATA-EMIT-FAIL]', err)
          }
        }

        await write('done', {})
      } catch (err) {
        await write('error', { error: (err as Error).message })
      } finally {
        await writer.close()

        if (flagOn && budgetRow && budgetMonth && tierKey) {
          try {
            await logCall(supabaseAdmin, familyCode!, budgetMonth, 'haiku', {
              input_tokens:                inputTokens,
              output_tokens:               outputTokens,
              cache_read_input_tokens:     cacheReadTokens,
              cache_creation_input_tokens: cacheCreateTokens,
            })
          } catch (err) {
            console.error('[AI-CHAT-BUDGET-LOG-FAIL]', { user_id: user.id, family_code: familyCode, err })
          }
        }
      }
    })()

    return new Response(readable, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
