// Helper module for per-family AI budget tracking (Maggie Consolidation
// Phase A — cost protection only, NOT brand consolidation).
//
// Per-endpoint sub-cap model:
//   - /maggie-chat enforces a per-tier cap against Sonnet-only spend
//   - /ai-chat    enforces a per-tier cap against Haiku-only spend
//   - Trial families share a SINGLE $4 pool across both endpoints
//     (because their total Anthropic exposure is what matters, not which
//      endpoint they used).
//
// The migration's `budget_dollars` column stores the COMBINED ceiling
// ($4 / $4 / $12 by tier) which acts as an outer tripwire via
// `budget_exceeded_at`. The real gating happens here in TypeScript using
// per-endpoint slices, so `budget_exceeded_at` is informational/analytics
// only — under normal use it won't fire before our per-endpoint gates do.
//
// See: supabase/migrations/20260512_maggie_consolidation.sql
//      supabase/migrations/20260512_maggie_consolidation_tier_fix.sql

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TierKey     = 'trial' | 'paid' | 'premium_plus';
export type ModelKey    = 'haiku' | 'sonnet';
export type EndpointKey = 'maggie' | 'ai';

export interface BudgetRow {
  id: string;
  family_code: string;
  month: string;
  tier: TierKey;
  haiku_input_tokens: number;
  haiku_output_tokens: number;
  haiku_cache_read_tokens: number;
  haiku_cache_creation_tokens: number;
  sonnet_input_tokens: number;
  sonnet_output_tokens: number;
  sonnet_cache_read_tokens: number;
  sonnet_cache_creation_tokens: number;
  total_dollars_spent: string | number;  // numeric returns as string from PostgREST
  budget_dollars:      string | number;
  warning_80_sent_at:  string | null;
  budget_exceeded_at:  string | null;
  created_at: string;
  last_updated: string;
}

export interface UsageMetadata {
  budget_used_pct: number;
  budget_remaining_dollars: number;
  days_until_reset: number;
  warning_threshold_hit: boolean;
  budget_exceeded: boolean;
}

export interface CallUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------
// Resolved at module load. Edge fn instances are short-lived (≤15 min idle)
// so a flag flip propagates within minutes via Supabase function restart.

const GLOBAL_ENABLED = Deno.env.get('MAGGIE_CONSOLIDATION_ENABLED') === 'true';
const TEST_USER_IDS  = (Deno.env.get('MAGGIE_CONSOLIDATION_TEST_USERS') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export function isConsolidationEnabledFor(userId: string): boolean {
  if (GLOBAL_ENABLED) return true;
  return TEST_USER_IDS.includes(userId);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function normalizeTier(value: unknown): TierKey | null {
  if (value === 'trial' || value === 'paid' || value === 'premium_plus') return value;
  return null;
}

export function currentMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function daysUntilNextMonth(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0);
  return Math.max(0, Math.ceil((next - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export function resetDateLabel(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString('en-US', {
    month:    'long',
    day:      'numeric',
    year:     'numeric',
    timeZone: 'UTC',
  });
}

// ---------------------------------------------------------------------------
// Per-endpoint dollar slices
// ---------------------------------------------------------------------------
// ============================================================================
// 2026 Anthropic pricing — PER MILLION TOKENS
//
// !! IF YOU CHANGE THESE VALUES, YOU MUST ALSO UPDATE:
//    supabase/migrations/20260512_maggie_consolidation.sql
//    (function: calculate_dollars_spent)
//
// Failure to keep these in sync = TS gates and DB tripwires drift apart.
// ============================================================================
//   Haiku 4.5:   input $1.00  | output $5.00  | cache_read $0.10 | cache_create $1.25
//   Sonnet 4.6:  input $3.00  | output $15.00 | cache_read $0.30 | cache_create $3.75
// 5-min ephemeral cache TTL.

function roundDollars(d: number): number {
  return Math.round(d * 10000) / 10000;
}

export function ssAIDollarsSpent(row: BudgetRow): number {
  return roundDollars(
      (Number(row.haiku_input_tokens)          *  1.00 / 1_000_000)
    + (Number(row.haiku_output_tokens)         *  5.00 / 1_000_000)
    + (Number(row.haiku_cache_read_tokens)     *  0.10 / 1_000_000)
    + (Number(row.haiku_cache_creation_tokens) *  1.25 / 1_000_000),
  );
}

export function maggieDollarsSpent(row: BudgetRow): number {
  return roundDollars(
      (Number(row.sonnet_input_tokens)          *  3.00 / 1_000_000)
    + (Number(row.sonnet_output_tokens)         * 15.00 / 1_000_000)
    + (Number(row.sonnet_cache_read_tokens)     *  0.30 / 1_000_000)
    + (Number(row.sonnet_cache_creation_tokens) *  3.75 / 1_000_000),
  );
}

// Per-endpoint, per-tier caps. Trial uses a COMBINED $4 pool — handled
// inside spendForEndpoint() below.
export function maggieCapForTier(tier: TierKey): number {
  if (tier === 'premium_plus') return 8.00;
  if (tier === 'trial')        return 4.00;  // combined-pool participant
  return 0;  // 'paid' locked out of /maggie-chat by existing tier gate
}

export function ssAICapForTier(tier: TierKey): number {
  if (tier === 'premium_plus') return 4.00;
  if (tier === 'paid')         return 4.00;
  if (tier === 'trial')        return 4.00;  // combined-pool participant
  return 0;
}

export function capForEndpoint(endpoint: EndpointKey, tier: TierKey): number {
  return endpoint === 'maggie' ? maggieCapForTier(tier) : ssAICapForTier(tier);
}

export function spendForEndpoint(endpoint: EndpointKey, tier: TierKey, row: BudgetRow): number {
  // Trial families: single combined-pool view across both endpoints.
  if (tier === 'trial') return Number(row.total_dollars_spent);
  return endpoint === 'maggie' ? maggieDollarsSpent(row) : ssAIDollarsSpent(row);
}

export function isOverCap(endpoint: EndpointKey, tier: TierKey, row: BudgetRow): boolean {
  const cap = capForEndpoint(endpoint, tier);
  if (cap <= 0) return true;            // fail closed if cap is 0 (free / locked tier)
  return spendForEndpoint(endpoint, tier, row) >= cap;
}

export function buildUsageMetadata(
  endpoint: EndpointKey,
  tier:     TierKey,
  row:      BudgetRow,
  now:      Date = new Date(),
): UsageMetadata {
  const cap   = capForEndpoint(endpoint, tier);
  const spend = spendForEndpoint(endpoint, tier, row);
  return {
    budget_used_pct:          cap > 0 ? Math.round((spend / cap) * 1000) / 10 : 0,
    budget_remaining_dollars: roundDollars(Math.max(0, cap - spend)),
    days_until_reset:         daysUntilNextMonth(now),
    warning_threshold_hit:    cap > 0 && spend >= cap * 0.8,
    budget_exceeded:          cap > 0 && spend >= cap,
  };
}

// ---------------------------------------------------------------------------
// DB-touching helpers
// ---------------------------------------------------------------------------

export async function loadOrCreateBudget(
  admin:      any,
  familyCode: string,
  tier:       TierKey,
  month:      string,
): Promise<BudgetRow> {
  const { data, error } = await admin.rpc('upsert_ai_budget_row', {
    p_family_code: familyCode,
    p_tier:        tier,
    p_month:       month,
  });
  if (error) {
    throw new Error(`loadOrCreateBudget: ${error.message || JSON.stringify(error)}`);
  }
  // Composite return type comes back as object or 1-element array depending
  // on the supabase-js version. Normalize.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('loadOrCreateBudget: no row returned');
  return row as BudgetRow;
}

export async function logCall(
  admin:      any,
  familyCode: string,
  month:      string,
  model:      ModelKey,
  usage:      CallUsage,
): Promise<BudgetRow> {
  const { data, error } = await admin.rpc('log_maggie_call', {
    p_family_code:         familyCode,
    p_month:               month,
    p_model:               model,
    p_input_tokens:        usage.input_tokens || 0,
    p_output_tokens:       usage.output_tokens || 0,
    p_cache_read_tokens:   usage.cache_read_input_tokens || 0,
    p_cache_create_tokens: usage.cache_creation_input_tokens || 0,
  });
  if (error) {
    throw new Error(`logCall: ${error.message || JSON.stringify(error)}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('logCall: no row returned');
  return row as BudgetRow;
}
