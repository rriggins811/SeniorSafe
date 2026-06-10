// Maggie chat edge function (Premium+ tier, Claude Sonnet 4.6).
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

const DAILY_LIMIT = 100
const FAMILY_CONTEXT_TOKEN_CAP = 3000
const PROMPT_CACHE_TTL_MS = 60_000

const OFF_TOPIC_MARKERS = [
  'served by SeniorSafe AI',
  "I'm Maggie, the Premium+ specialist",
  'SeniorSafe AI is the right starting point',
  'Premium+ specialist for senior transitions',
  'SeniorSafe AI tab in this same app',
  'Slide over to that tab',
]

let cachedSystemPrompt: string | null = null
let cachedKnowledgeBase: string | null = null
let cachedAt = 0

async function loadPrompts(): Promise<{ systemPrompt: string; knowledgeBase: string }> {
  const now = Date.now()
  if (cachedSystemPrompt && cachedKnowledgeBase && (now - cachedAt) < PROMPT_CACHE_TTL_MS) {
    return { systemPrompt: cachedSystemPrompt, knowledgeBase: cachedKnowledgeBase }
  }

  const { data, error } = await supabaseAdmin
    .from('maggie_prompts')
    .select('name, content')
    .in('name', ['system_prompt_v1', 'knowledge_base_v1'])

  if (error || !data) {
    throw new Error(`Failed to load Maggie prompts: ${error?.message || 'no data'}`)
  }

  let sp: string | null = null
  let kb: string | null = null
  for (const row of data) {
    if (row.name === 'system_prompt_v1') sp = row.content
    else if (row.name === 'knowledge_base_v1') kb = row.content
  }

  if (!sp || !kb) {
    throw new Error('Maggie prompts table missing required rows (system_prompt_v1, knowledge_base_v1)')
  }

  cachedSystemPrompt = sp
  cachedKnowledgeBase = kb
  cachedAt = now
  return { systemPrompt: sp, knowledgeBase: kb }
}

function jsonResponse(body: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function approxTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

function buildPerUserContext(
  profile: any,
  familySummary: string,
  recentTopics: string[],
): string {
  const parts: string[] = []
  parts.push('## Per-user context (NOT cached, refreshed each call)')
  parts.push('')
  parts.push('### About the user you are talking to right now')
  parts.push(`- Name: ${profile.first_name || 'Unknown'}`)
  parts.push(`- Role: ${profile.role || 'admin'}`)
  if (profile.family_name) parts.push(`- Family: ${profile.family_name}`)
  parts.push(`- Tier: premium_plus (Maggie)`)

  if (profile.senior_name) {
    parts.push('')
    parts.push('### Family snapshot (from onboarding)')
    parts.push(`- Senior's name: ${profile.senior_name}`)
    if (profile.senior_age) parts.push(`- Age: ${profile.senior_age}`)
    if (profile.living_situation) parts.push(`- Living situation: ${profile.living_situation}`)
    if (profile.timeline) parts.push(`- Timeline: ${profile.timeline}`)
    if (profile.biggest_concern) parts.push(`- Biggest concern: ${profile.biggest_concern}`)
    parts.push(`- Use ${profile.senior_name}'s name naturally when appropriate.`)
  }

  if (familySummary && familySummary.trim().length > 0) {
    parts.push('')
    parts.push('### Family context memory (running summary, capped at ~3000 tokens)')
    parts.push(familySummary)
  }

  if (recentTopics && recentTopics.length > 0) {
    parts.push('')
    parts.push(`### Recent conversation topics: ${recentTopics.join(', ')}`)
  }

  return parts.join('\n')
}

function detectOffTopicRedirect(reply: string): boolean {
  return OFF_TOPIC_MARKERS.some(m => reply.includes(m))
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  if (req.method === 'GET' || url.searchParams.get('warmup') === '1') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401, corsHeaders)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }

    const { data: profile } = await supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return jsonResponse({ error: 'Profile not found' }, 404, corsHeaders)
    }

    let familyCode: string | null = profile.family_code
    let effectiveTier: string = profile.subscription_tier || 'free'

    if (profile.role === 'member' && profile.invited_by) {
      const { data: admin } = await supabaseAdmin
        .from('user_profile')
        .select('family_code, subscription_tier')
        .eq('user_id', profile.invited_by)
        .single()
      if (admin) {
        familyCode = admin.family_code
        effectiveTier = admin.subscription_tier || 'free'
      }
    }

    if (effectiveTier !== 'premium_plus' && effectiveTier !== 'trial') {
      return jsonResponse({
        error: 'tier_required',
        message: "Maggie is part of Premium+ ($39.99/month). On Premium and Free, the in-app SeniorSafe AI is your daily buddy. Upgrade to Premium+ when you're ready.",
        required_tier: 'premium_plus',
      }, 402, corsHeaders)
    }

    if (!familyCode) {
      return jsonResponse({ error: 'No family code found' }, 400, corsHeaders)
    }

    const flagOn = isConsolidationEnabledFor(user.id)
    let budgetRow:   BudgetRow | null = null
    let budgetMonth: string    | null = null
    let tierKey:     TierKey   | null = null

    if (flagOn) {
      tierKey = normalizeTier(effectiveTier)
      if (!tierKey) {
        return jsonResponse({ error: 'internal_tier_normalize_failed' }, 500, corsHeaders)
      }
      budgetMonth = currentMonth()

      try {
        budgetRow = await loadOrCreateBudget(supabaseAdmin, familyCode, tierKey, budgetMonth)
      } catch (err) {
        console.error('[MAGGIE-BUDGET-LOAD-FAIL]', { user_id: user.id, family_code: familyCode, err })
      }

      if (budgetRow && isOverCap('maggie', tierKey, budgetRow)) {
        const meta = buildUsageMetadata('maggie', tierKey, budgetRow)
        return jsonResponse({
          error: 'BUDGET_EXCEEDED',
          message: `You've used 100% of your monthly Maggie budget. Resets ${resetDateLabel()}.`,
          reset_date:    resetDateLabel(),
          current_tier:  tierKey,
          upgrade_url:   tierKey === 'trial' ? '/upgrade' : null,
          _usage_metadata: meta,
        }, 429, corsHeaders)
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const { data: usageRow } = await supabaseAdmin
      .from('maggie_usage')
      .select('message_count')
      .eq('user_id', user.id)
      .eq('usage_date', today)
      .maybeSingle()

    const usedToday = usageRow?.message_count ?? 0
    if (usedToday >= DAILY_LIMIT) {
      return jsonResponse({
        error: 'rate_limited',
        message: "I've helped you a lot today. Let's pick this up tomorrow so I can give you my best.",
        used_today: usedToday,
        daily_limit: DAILY_LIMIT,
      }, 429, corsHeaders)
    }

    const body = await req.json().catch(() => ({}))
    const { messages, recentTopics = [] } = body
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: 'messages array is required' }, 400, corsHeaders)
    }

    const { data: ctxRow } = await supabaseAdmin
      .from('family_context')
      .select('summary, token_count')
      .eq('family_code', familyCode)
      .maybeSingle()

    let familySummary = ctxRow?.summary || ''
    if (approxTokenCount(familySummary) > FAMILY_CONTEXT_TOKEN_CAP) {
      familySummary = familySummary.slice(-FAMILY_CONTEXT_TOKEN_CAP * 4)
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500, corsHeaders)
    }

    let systemPrompt: string
    let knowledgeBase: string
    try {
      const prompts = await loadPrompts()
      systemPrompt = prompts.systemPrompt
      knowledgeBase = prompts.knowledgeBase
    } catch (err) {
      return jsonResponse({ error: `Prompt load failed: ${(err as Error).message}` }, 500, corsHeaders)
    }

    const perUserContext = buildPerUserContext(profile, familySummary, recentTopics)

    const systemPayload = [
      { type: 'text', text: systemPrompt,    cache_control: { type: 'ephemeral' } },
      { type: 'text', text: knowledgeBase,   cache_control: { type: 'ephemeral' } },
      { type: 'text', text: perUserContext },
    ]

    const anthropicInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        stream: true,
        system: systemPayload,
        messages,
      }),
    }

    let anthropicRes = await fetch('https://api.anthropic.com/v1/messages', anthropicInit)

    if (!anthropicRes.ok && anthropicRes.status >= 400 && anthropicRes.status < 500) {
      const firstErr = await anthropicRes.text().catch(() => '')
      console.warn(`Anthropic ${anthropicRes.status} on first try, retrying after 1s. Body: ${firstErr.slice(0, 500)}`)
      await new Promise(r => setTimeout(r, 1000))
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', anthropicInit)
    }

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => '')
      console.error(`Anthropic still failing after retry: ${anthropicRes.status}. Body: ${errBody.slice(0, 500)}`)
      return jsonResponse({
        error: 'One sec, Maggie is getting ready. Try again in a moment.',
      }, 502, corsHeaders)
    }

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const enc = new TextEncoder()

    const write = (event: string, data: unknown) =>
      writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

    let fullReply = ''
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreateTokens = 0

    ;(async () => {
      try {
        await write('meta', {
          tier: 'premium_plus',
          used_today: usedToday + 1,
          daily_limit: DAILY_LIMIT,
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
            const json = line.slice(6).trim()
            if (json === '[DONE]') continue
            try {
              const evt = JSON.parse(json)

              if (evt.type === 'message_start' && evt.message?.usage) {
                const u = evt.message.usage
                inputTokens       = u.input_tokens || 0
                cacheReadTokens   = u.cache_read_input_tokens || 0
                cacheCreateTokens = u.cache_creation_input_tokens || 0
              }

              if (evt.type === 'content_block_delta' && evt.delta?.text) {
                const chunk = evt.delta.text
                fullReply += chunk
                await write('text', { text: chunk })
              }

              if (evt.type === 'message_delta' && evt.usage?.output_tokens != null) {
                outputTokens = evt.usage.output_tokens
              }
            } catch { /* skip unparseable */ }
          }
        }

        if (flagOn && budgetRow && tierKey) {
          try {
            const synthRow: BudgetRow = {
              ...budgetRow,
              sonnet_input_tokens:          Number(budgetRow.sonnet_input_tokens)          + inputTokens,
              sonnet_output_tokens:         Number(budgetRow.sonnet_output_tokens)         + outputTokens,
              sonnet_cache_read_tokens:     Number(budgetRow.sonnet_cache_read_tokens)     + cacheReadTokens,
              sonnet_cache_creation_tokens: Number(budgetRow.sonnet_cache_creation_tokens) + cacheCreateTokens,
            }
            if (tierKey === 'trial') {
              synthRow.total_dollars_spent = ssAIDollarsSpent(synthRow) + maggieDollarsSpent(synthRow)
            }
            await write('usage_metadata', buildUsageMetadata('maggie', tierKey, synthRow))
          } catch (err) {
            console.error('[MAGGIE-METADATA-EMIT-FAIL]', err)
          }
        }

        await write('done', {})
      } catch (err) {
        await write('error', { error: (err as Error).message })
      } finally {
        await writer.close()

        try {
          const offTopic = detectOffTopicRedirect(fullReply) ? 1 : 0
          await supabaseAdmin.rpc('increment_maggie_usage', {
            p_user_id: user.id,
            p_input_tokens: inputTokens,
            p_output_tokens: outputTokens,
            p_cache_read: cacheReadTokens,
            p_cache_create: cacheCreateTokens,
            p_off_topic: offTopic,
          })
        } catch (e) {
          console.error('telemetry log failed', e)
        }

        if (flagOn && budgetRow && budgetMonth && tierKey) {
          try {
            await logCall(
              supabaseAdmin,
              familyCode!,
              budgetMonth,
              'sonnet',
              {
                input_tokens:                inputTokens,
                output_tokens:               outputTokens,
                cache_read_input_tokens:     cacheReadTokens,
                cache_creation_input_tokens: cacheCreateTokens,
              },
            )
          } catch (err) {
            console.error('[MAGGIE-BUDGET-LOG-FAIL]', { user_id: user.id, family_code: familyCode, err })
          }
        }
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
    return jsonResponse(
      { error: (error as Error).message },
      500,
      corsHeaders,
    )
  }
})
