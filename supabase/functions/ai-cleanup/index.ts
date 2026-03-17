import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// AI Cleanup Cron — runs nightly at 3 AM EST (8 AM UTC)
// Schedule in Supabase Dashboard → Edge Functions → Schedule → 0 8 * * *
//
// 1. Delete conversations older than 90 days (messages cascade via FK)
// 2. Delete ai_usage rows older than 6 months
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

serve(async (_req) => {
  try {
    const now = new Date()

    // 1. Delete conversations older than 90 days (messages cascade)
    const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data: deletedConvs, error: convErr } = await supabaseAdmin
      .from('ai_conversations')
      .delete()
      .lt('created_at', cutoff90)
      .select('id')

    if (convErr) console.error('[ai-cleanup] Conv delete error:', convErr.message)
    const convsDeleted = deletedConvs?.length || 0

    // 2. Delete ai_usage rows older than 6 months
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1)
    const cutoffMonth = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`
    const { data: deletedUsage, error: usageErr } = await supabaseAdmin
      .from('ai_usage')
      .delete()
      .lt('month_year', cutoffMonth)
      .select('id')

    if (usageErr) console.error('[ai-cleanup] Usage delete error:', usageErr.message)
    const usageDeleted = deletedUsage?.length || 0

    const log = `[ai-cleanup] Cleaned up ${convsDeleted} conversations and ${usageDeleted} usage records`
    console.log(log)

    return new Response(JSON.stringify({
      success: true,
      conversations_deleted: convsDeleted,
      usage_records_deleted: usageDeleted,
      message: log,
    }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const msg = (error as Error).message
    console.error('[ai-cleanup] Fatal error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
