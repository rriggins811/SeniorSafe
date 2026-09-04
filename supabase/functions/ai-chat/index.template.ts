import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Maggie, the one SeniorSafe assistant (2026-09-04 merge of ai-chat and
// maggie-chat). GENERATED FILE: edit the parts, then run
//   node scripts/build-ai-chat.mjs
// Parts: supabase/prompts/maggie-system-prompt-v2.md (voice, rules, facts),
// supabase/prompts/maggie-knowledge-base.md (Blueprint reference, attached by
// topic), src/content/setupFaq.js (app help), and this template (the code).
//
// Model: Claude Haiku 4.5. The cached prefix (prompt + framework + app help)
// must stay above 1024 tokens or prompt caching silently stops; the build
// script prints its size.
//
// Limits: free families get FREE_LIMIT messages ever; trial and paid families
// get PAID_LIMIT a month and a MONTHLY_CAP_DOLLARS Haiku budget per family.

const MODEL = 'claude-haiku-4-5-20251001'
const FREE_LIMIT = 10
const PAID_LIMIT = 500
const MONTHLY_CAP_DOLLARS = 4.00
const MAX_KB_SECTIONS = 2
const FAMILY_CONTEXT_TOKEN_CAP = 3000

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

// ---------------------------------------------------------------------------
// Prompt parts (injected by the build script)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `__SYSTEM_PROMPT__`

const FRAMEWORK = `__FRAMEWORK__`

const APP_HELP = `__APP_HELP__`

type KbSection = { n: number; title: string; keywords: string[]; text: string }
const KB_SECTIONS: KbSection[] = __KB_SECTIONS__

// The whole cached prefix, in one block so one cache breakpoint covers it.
const CACHED_PREFIX = [
  SYSTEM_PROMPT,
  '',
  '# Blueprint framework (always applies)',
  '',
  FRAMEWORK,
  '',
  APP_HELP,
].join('\n')

// ---------------------------------------------------------------------------
// Knowledge base lookup: the one or two sections that match the question.
// ---------------------------------------------------------------------------

function pickSections(messages: Array<{ role: string; content: unknown }>): KbSection[] {
  const recentUser = messages
    .filter(m => m.role === 'user')
    .slice(-2)
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join(' ')
    .toLowerCase()
  if (!recentUser.trim()) return []
  const scored = KB_SECTIONS
    .map(s => ({ s, score: s.keywords.reduce((n, k) => n + (recentUser.includes(k) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_KB_SECTIONS).map(x => x.s)
}

// ---------------------------------------------------------------------------
// Budget (Haiku only). Mirrors supabase/migrations/20260512_maggie_consolidation.sql
// pricing: input $1.00, output $5.00, cache read $0.10, cache write $1.25 per
// million tokens.
// ---------------------------------------------------------------------------

type TierKey = 'trial' | 'paid'
type BudgetRow = {
  haiku_input_tokens: number | string
  haiku_output_tokens: number | string
  haiku_cache_read_tokens: number | string
  haiku_cache_creation_tokens: number | string
  [k: string]: unknown
}

function tierKeyFor(tier: string): TierKey | null {
  if (tier === 'trial') return 'trial'
  if (tier === 'paid' || tier === 'premium_plus') return 'paid'
  return null
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function resetDateLabel(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function daysUntilReset(): number {
  const now = new Date()
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return Math.max(0, Math.ceil((next - now.getTime()) / 86400000))
}

function haikuDollars(row: BudgetRow): number {
  const d = (Number(row.haiku_input_tokens) * 1.00
    + Number(row.haiku_output_tokens) * 5.00
    + Number(row.haiku_cache_read_tokens) * 0.10
    + Number(row.haiku_cache_creation_tokens) * 1.25) / 1_000_000
  return Math.round(d * 10000) / 10000
}

function usageMetadata(row: BudgetRow) {
  const spend = haikuDollars(row)
  return {
    budget_used_pct: Math.round((spend / MONTHLY_CAP_DOLLARS) * 1000) / 10,
    budget_remaining_dollars: Math.round(Math.max(0, MONTHLY_CAP_DOLLARS - spend) * 10000) / 10000,
    days_until_reset: daysUntilReset(),
    warning_threshold_hit: spend >= MONTHLY_CAP_DOLLARS * 0.8,
    budget_exceeded: spend >= MONTHLY_CAP_DOLLARS,
  }
}

async function loadBudget(familyCode: string, tier: TierKey, month: string): Promise<BudgetRow | null> {
  const { data, error } = await supabaseAdmin.rpc('upsert_ai_budget_row', { p_family_code: familyCode, p_tier: tier, p_month: month })
  if (error) { console.error('[MAGGIE-BUDGET-LOAD-FAIL]', familyCode, error.message); return null }
  const row = Array.isArray(data) ? data[0] : data
  return (row as BudgetRow) || null
}

async function logCall(familyCode: string, month: string, usage: { input: number; output: number; cacheRead: number; cacheCreate: number }) {
  const { error } = await supabaseAdmin.rpc('log_maggie_call', {
    p_family_code: familyCode,
    p_month: month,
    p_model: 'haiku',
    p_input_tokens: usage.input,
    p_output_tokens: usage.output,
    p_cache_read_tokens: usage.cacheRead,
    p_cache_create_tokens: usage.cacheCreate,
  })
  if (error) console.error('[MAGGIE-BUDGET-LOG-FAIL]', familyCode, error.message)
}

// ---------------------------------------------------------------------------
// Per-call context (never cached): who is typing, the family, memory.
// ---------------------------------------------------------------------------

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function buildContext(opts: {
  profile: any
  isSenior: boolean
  isOwner: boolean
  seniorName: string
  tier: string
  freeRemaining: number | null
  familySummary: string
  recentTopics: string[]
  medNames: string[]
  firstConversation: boolean
  sections: KbSection[]
}): string {
  const p = opts.profile
  const lines: string[] = ['# Context for this conversation (not shared with the family)', '']
  const who = opts.isSenior
    ? 'the person who checks in each day (the senior)'
    : opts.isOwner
    ? 'the family member who set up SeniorSafe for someone they look after (usually the adult child)'
    : 'a family member who joined the family (a sibling, spouse, or caregiver)'
  lines.push(`You are talking with ${p.first_name || 'someone'}, ${who}.`)
  if (!opts.isSenior && opts.seniorName) lines.push(`The person they look after is ${opts.seniorName}.`)
  if (p.family_name) lines.push(`Family: ${p.family_name}.`)
  if (opts.tier === 'free' && opts.freeRemaining !== null) {
    lines.push(`This family is on the free plan with ${opts.freeRemaining} message${opts.freeRemaining === 1 ? '' : 's'} left, ever.`)
  } else if (opts.tier === 'trial') {
    lines.push('This family is in the free 14-day trial of the paid plan.')
  } else {
    lines.push('This family is on the paid plan.')
  }
  if (opts.firstConversation) lines.push('This is their first conversation with you. Open with one warm line saying you are Maggie, an AI Ryan built, that you keep a running summary so they need not repeat themselves, and that they can clear it in Settings. Then answer.')
  if (opts.medNames.length) lines.push(`Medications being tracked in the app (names only): ${opts.medNames.join(', ')}.`)
  if (opts.recentTopics.length) lines.push(`Their recent conversation titles: ${opts.recentTopics.join('; ')}.`)
  if (opts.familySummary.trim()) {
    lines.push('', '## Running family summary from earlier conversations', opts.familySummary.trim())
  }
  for (const s of opts.sections) {
    lines.push('', `## Blueprint reference: ${s.title}`, s.text)
  }
  return lines.join('\n')
}

// House style: no em dashes. The model still reaches for them now and then,
// so the stream is tidied on the way out. One character each, so chunk
// boundaries cannot split them.
function tidy(text: string): string {
  return text.replace(/\u2014/g, ', ').replace(/\u2013/g, '-').replace(/ , /g, ', ')
}

function json(body: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  if (req.method === 'GET' || url.searchParams.get('warmup') === '1') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401, corsHeaders)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401, corsHeaders)

    const { data: profile } = await supabase.from('user_profile').select('*').eq('user_id', user.id).single()
    if (!profile) return json({ error: 'Profile not found' }, 404, corsHeaders)

    // Family: owner holds the code and the plan. The senior may be the owner
    // or a member (is_senior).
    const ownerId: string = profile.invited_by || profile.user_id
    let owner = profile
    if (ownerId !== profile.user_id) {
      const { data: o } = await supabaseAdmin
        .from('user_profile')
        .select('user_id, family_code, subscription_tier, senior_name, first_name')
        .eq('user_id', ownerId)
        .single()
      if (o) owner = { ...profile, ...o, user_id: profile.user_id }
    }
    const familyCode: string | null = owner.family_code || profile.family_code
    const tier: string = owner.subscription_tier || 'free'
    if (!familyCode) return json({ error: 'No family code found' }, 400, corsHeaders)

    const { data: seniorRow } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, first_name')
      .eq('is_senior', true)
      .or(`user_id.eq.${ownerId},invited_by.eq.${ownerId}`)
      .maybeSingle()
    const isSenior = !!profile.is_senior
    const isOwner = ownerId === profile.user_id
    const seniorName: string = seniorRow?.first_name || owner.senior_name || ''

    console.log('[MAGGIE-CALL]', { user_id: user.id, tier, senior: isSenior, ts: new Date().toISOString() })

    // ---- Limits ----------------------------------------------------------
    const month = currentMonth()
    const tierKey = tierKeyFor(tier)
    let usageCount = 0
    if (!tierKey) {
      const { data: total } = await supabaseAdmin.rpc('get_family_total_usage', { p_family_code: familyCode })
      usageCount = total || 0
      if (usageCount >= FREE_LIMIT) {
        return json({
          error: 'limit_reached',
          message: `You've used all ${FREE_LIMIT} free messages with Maggie. The paid plan ($14.99 a month) includes her every day.`,
          count: usageCount, limit: FREE_LIMIT, tier,
        }, 429, corsHeaders)
      }
    } else {
      const { data: monthCount } = await supabaseAdmin.rpc('get_family_usage', { p_family_code: familyCode, p_month_year: month })
      usageCount = monthCount || 0
      if (usageCount >= PAID_LIMIT) {
        return json({
          error: 'limit_reached',
          message: `Your family has used all ${PAID_LIMIT} messages this month. They refresh on ${resetDateLabel()}.`,
          count: usageCount, limit: PAID_LIMIT, tier,
        }, 429, corsHeaders)
      }
    }

    let budgetRow: BudgetRow | null = null
    if (tierKey) {
      budgetRow = await loadBudget(familyCode, tierKey, month)
      if (budgetRow && haikuDollars(budgetRow) >= MONTHLY_CAP_DOLLARS) {
        return json({
          error: 'BUDGET_EXCEEDED',
          message: `Your family has used this month's Maggie budget. It resets ${resetDateLabel()}.`,
          reset_date: resetDateLabel(),
          current_tier: tierKey,
          _usage_metadata: usageMetadata(budgetRow),
        }, 429, corsHeaders)
      }
    }

    const body = await req.json().catch(() => ({}))
    const { messages, recentTopics = [] } = body
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'messages array is required' }, 400, corsHeaders)
    }

    const { data: newCount } = await supabaseAdmin.rpc('increment_family_usage', { p_family_code: familyCode, p_month_year: month })
    const limit = tierKey ? PAID_LIMIT : FREE_LIMIT
    const count = newCount || usageCount + 1

    // ---- Context ---------------------------------------------------------
    const { data: medsData } = await supabase.from('medications').select('med_name').eq('active', true).limit(10)
    const medNames = (medsData || []).map((m: any) => m.med_name).filter(Boolean)

    const { data: ctxRow } = await supabaseAdmin
      .from('family_context').select('summary').eq('family_code', familyCode).maybeSingle()
    let familySummary: string = ctxRow?.summary || ''
    if (approxTokens(familySummary) > FAMILY_CONTEXT_TOKEN_CAP) familySummary = familySummary.slice(-FAMILY_CONTEXT_TOKEN_CAP * 4)

    const { count: priorConversations } = await supabaseAdmin
      .from('ai_conversations').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    const firstConversation = (priorConversations || 0) <= 1 && messages.length <= 1

    const sections = pickSections(messages)
    const context = buildContext({
      profile, isSenior, isOwner, seniorName, tier,
      freeRemaining: tierKey ? null : Math.max(0, FREE_LIMIT - count),
      familySummary, recentTopics: Array.isArray(recentTopics) ? recentTopics.slice(0, 3) : [],
      medNames, firstConversation, sections,
    })

    // ---- Anthropic -------------------------------------------------------
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500, corsHeaders)

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        stream: true,
        system: [
          { type: 'text', text: CACHED_PREFIX, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: context },
        ],
        messages: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') })),
      }),
    })

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}))
      console.error('[MAGGIE-ANTHROPIC-FAIL]', anthropicRes.status, JSON.stringify(err).slice(0, 300))
      return json({ error: 'Maggie is having trouble right now. Please try again in a moment.' }, 502, corsHeaders)
    }

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const enc = new TextEncoder()
    const write = (event: string, data: unknown) =>
      writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreateTokens = 0

    ;(async () => {
      try {
        await write('meta', { count, limit, tier, sections: sections.map(s => s.n) })
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
            const payload = line.slice(6)
            if (payload === '[DONE]') continue
            try {
              const evt = JSON.parse(payload)
              if (evt.type === 'message_start' && evt.message?.usage) {
                const u = evt.message.usage
                inputTokens = u.input_tokens || 0
                cacheReadTokens = u.cache_read_input_tokens || 0
                cacheCreateTokens = u.cache_creation_input_tokens || 0
              }
              if (evt.type === 'message_delta' && evt.usage?.output_tokens != null) outputTokens = evt.usage.output_tokens
              if (evt.type === 'content_block_delta' && evt.delta?.text) await write('text', { text: tidy(evt.delta.text) })
            } catch { /* skip */ }
          }
        }
        if (budgetRow) {
          const synth: BudgetRow = {
            ...budgetRow,
            haiku_input_tokens: Number(budgetRow.haiku_input_tokens) + inputTokens,
            haiku_output_tokens: Number(budgetRow.haiku_output_tokens) + outputTokens,
            haiku_cache_read_tokens: Number(budgetRow.haiku_cache_read_tokens) + cacheReadTokens,
            haiku_cache_creation_tokens: Number(budgetRow.haiku_cache_creation_tokens) + cacheCreateTokens,
          }
          await write('usage_metadata', usageMetadata(synth))
        }
        console.log('[MAGGIE-USAGE]', { input: inputTokens, output: outputTokens, cache_read: cacheReadTokens, cache_create: cacheCreateTokens })
        await write('done', {})
      } catch (err) {
        await write('error', { error: (err as Error).message })
      } finally {
        await writer.close()
        if (tierKey) {
          await logCall(familyCode, month, { input: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheCreate: cacheCreateTokens })
        }
      }
    })()

    return new Response(readable, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  } catch (error) {
    console.error('[MAGGIE-ERROR]', (error as Error).message)
    return json({ error: (error as Error).message }, 500, corsHeaders)
  }
})
