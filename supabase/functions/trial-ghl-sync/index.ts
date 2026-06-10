import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// trial-ghl-sync (scheduled every 15 min via pg_cron). Wires SeniorSafe app
// trial signups (Supabase user_profile) -> GHL contact + the workflow-trigger
// tag. Invoked by cron with the Vault service_role_key as Bearer
// (verify_jwt=true). Reuses GHL_PIT_TOKEN + GHL_LOCATION_ID directly (bypasses
// ghl-proxy), so it does its own ADDITIVE tagging (upsert WITHOUT tags, then
// POST /contacts/{id}/tags) -- GHL upsert-with-tags REPLACES the tag set.
//
// LIFECYCLE: expired -> add `seniorsafe trial - expired`, remove active.
// converted -> apply the paid-tier tag (`seniorsafe-premium` for 'paid',
// `seniorsafe-premium-plus` for 'premium_plus') so the nurture exit condition
// fires, then remove the active tag. Catches Stripe AND Apple/Google IAP
// conversions. Idempotent via ghl_contact_id + ghl_trial_stage. Body
// { "dry": true } = count-only.

const BASE = "https://services.leadconnectorhq.com"
const VER = "2021-07-28"

const TAG_ACTIVE = "seniorsafe trial - active"
const TAG_EXPIRED = "seniorsafe trial - expired"
const TAG_SIGNUP = "seniorsafe-app-signup"
const TAG_BACKFILL = "trial-backfill-jun4"
const TAG_PREMIUM = "seniorsafe-premium"
const TAG_PREMIUM_PLUS = "seniorsafe-premium-plus"

const CUTOFF = Deno.env.get("TRIAL_SYNC_ACTIVE_CUTOFF") || "2026-06-04T00:00:00Z"

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } })
}

async function ghl(method: string, path: string, token: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: VER, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  }
  if (body !== undefined && method !== "GET") {
    ;(init.headers as Record<string, string>)["Content-Type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let parsed: unknown
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed as any }
}

serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const token = Deno.env.get("GHL_PIT_TOKEN") || ""
  const loc = Deno.env.get("GHL_LOCATION_ID") || ""
  if (!token || !loc) return j({ error: "GHL token/location not set" }, 500)

  let dry = false
  try { const b = await req.json(); dry = b?.dry === true } catch { /* no body */ }

  const summary = {
    dryRun: dry,
    cutoff: CUTOFF,
    newSynced: 0,
    backfilled: 0,
    expired: 0,
    converted: 0,
    errors: [] as Array<Record<string, unknown>>,
  }

  async function emailFor(userId: string): Promise<string | null> {
    const { data } = await supabase.auth.admin.getUserById(userId)
    return data?.user?.email ?? null
  }

  const { data: newTrials, error: e1 } = await supabase
    .from("user_profile")
    .select("user_id, first_name, last_name, phone, created_at")
    .eq("subscription_tier", "trial")
    .eq("trial_status", "active")
    .eq("role", "admin")
    .not("is_test", "is", true)
    .is("ghl_contact_id", null)
  if (e1) return j({ error: e1.message }, 500)

  for (const u of newTrials ?? []) {
    const isBackfill = new Date(u.created_at).getTime() < new Date(CUTOFF).getTime()
    const stage = isBackfill ? "backfill" : "active"
    const tags = isBackfill ? [TAG_SIGNUP, TAG_BACKFILL] : [TAG_ACTIVE, TAG_SIGNUP]
    try {
      const email = await emailFor(u.user_id)
      if (!email) { summary.errors.push({ user: u.user_id, err: "no email in auth.users" }); continue }
      if (dry) { isBackfill ? summary.backfilled++ : summary.newSynced++; continue }

      // ADDITIVE TAGGING: upsert WITHOUT tags, then add via the tag endpoint
      // (GHL upsert-with-tags replaces the whole tag set and would wipe tags
      // applied by other funnels).
      const up = await ghl("POST", "/contacts/upsert", token, {
        locationId: loc,
        email,
        firstName: u.first_name || undefined,
        lastName: u.last_name || undefined,
        phone: u.phone || undefined,
        source: "SeniorSafe app trial",
      })
      if (up.status < 200 || up.status >= 300) {
        console.error("trial-ghl-sync upsert fail", email, up.status, JSON.stringify(up.body))
        summary.errors.push({ user: u.user_id, email, op: "upsert", status: up.status, body: up.body })
        continue
      }
      const contactId = up.body?.contact?.id || up.body?.id
      if (!contactId) {
        summary.errors.push({ user: u.user_id, email, op: "upsert", err: "no contact id", body: up.body })
        continue
      }
      await ghl("POST", `/contacts/${contactId}/tags`, token, { tags })
      await supabase
        .from("user_profile")
        .update({ ghl_contact_id: contactId, ghl_synced_at: new Date().toISOString(), ghl_trial_stage: stage })
        .eq("user_id", u.user_id)
      isBackfill ? summary.backfilled++ : summary.newSynced++
    } catch (e) {
      summary.errors.push({ user: u.user_id, err: e instanceof Error ? e.message : String(e) })
    }
  }

  const { data: changed, error: e2 } = await supabase
    .from("user_profile")
    .select("user_id, ghl_contact_id, ghl_trial_stage, trial_status, subscription_tier")
    .not("ghl_contact_id", "is", null)
    .in("trial_status", ["expired", "converted"])
    .in("ghl_trial_stage", ["active", "backfill"])
  if (e2) return j({ error: e2.message }, 500)

  for (const u of changed ?? []) {
    try {
      if (u.trial_status === "expired") {
        if (!dry) {
          await ghl("POST", `/contacts/${u.ghl_contact_id}/tags`, token, { tags: [TAG_EXPIRED] })
          await ghl("DELETE", `/contacts/${u.ghl_contact_id}/tags`, token, { tags: [TAG_ACTIVE] })
          await supabase
            .from("user_profile")
            .update({ ghl_trial_stage: "expired", ghl_synced_at: new Date().toISOString() })
            .eq("user_id", u.user_id)
        }
        summary.expired++
      } else if (u.trial_status === "converted") {
        const tierTag =
          u.subscription_tier === "premium_plus"
            ? TAG_PREMIUM_PLUS
            : u.subscription_tier === "paid"
            ? TAG_PREMIUM
            : null
        if (!dry) {
          if (tierTag) {
            await ghl("POST", `/contacts/${u.ghl_contact_id}/tags`, token, { tags: [tierTag] })
          }
          await ghl("DELETE", `/contacts/${u.ghl_contact_id}/tags`, token, { tags: [TAG_ACTIVE] })
          await supabase
            .from("user_profile")
            .update({ ghl_trial_stage: "converted", ghl_synced_at: new Date().toISOString() })
            .eq("user_id", u.user_id)
        }
        summary.converted++
      }
    } catch (e) {
      summary.errors.push({ user: u.user_id, err: e instanceof Error ? e.message : String(e) })
    }
  }

  console.log("trial-ghl-sync", JSON.stringify(summary))
  const acted = summary.newSynced + summary.backfilled + summary.expired + summary.converted
  return j({ ok: true, ...summary }, summary.errors.length > 0 && acted === 0 ? 207 : 200)
})
