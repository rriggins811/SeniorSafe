// newsletter-send Edge Function (v6 — send_scheduled needs send:true flag,
// debug_env action removed for production hygiene)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const DEFAULT_AUDIENCE_ID = "4b294c03-f551-4db8-8d5c-0ed7e46e6683"
const DEFAULT_FROM = "Ryan Riggins <ryan@rigginsstrategicsolutions.com>"
const RESEND_API_BASE = "https://api.resend.com"

function getApiKey(): string | undefined {
  const variants = [
    "RESEND_AUDIENCES_API_KEY", "resend_audiences_api_key",
    "Resend_Audiences_API_Key", "RESEND_AUDIENCES_KEY",
    "RESEND_FULL_ACCESS_API_KEY", "RESEND_API_KEY_FULL",
  ]
  for (const name of variants) {
    const v = Deno.env.get(name)
    if (v && v.trim()) return v
  }
  return undefined
}

type SendBody = {
  action: "dry_run" | "send" | "send_scheduled"
  subject: string; html: string; text?: string; name?: string
  audienceId?: string; from?: string; scheduledAt?: string; replyTo?: string
}

function jsonResponse(p: unknown, s = 200): Response {
  return new Response(JSON.stringify(p), {
    status: s, headers: { "Content-Type": "application/json" },
  })
}

async function resend<T = unknown>(
  apiKey: string, method: "GET" | "POST", path: string, body?: unknown,
): Promise<{ ok: boolean; status: number; body: T }> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  }
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body)
  const res = await fetch(`${RESEND_API_BASE}${path}`, init)
  const text = await res.text()
  let payload: T
  try { payload = text ? JSON.parse(text) as T : ({} as T) }
  catch { payload = (text as unknown) as T }
  return { ok: res.ok, status: res.status, body: payload }
}

serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405)

  const apiKey = getApiKey()
  if (!apiKey) {
    return jsonResponse({
      ok: false,
      error: "Resend full-access API key not configured on Edge Function secrets",
    }, 500)
  }

  let body: SendBody
  try { body = await req.json() as SendBody }
  catch { return jsonResponse({ ok: false, error: "Invalid JSON" }, 400) }

  if (!body.action || !["dry_run", "send", "send_scheduled"].includes(body.action)) {
    return jsonResponse({ ok: false, error: "action must be dry_run | send | send_scheduled" }, 400)
  }
  if (!body.subject || !body.html) {
    return jsonResponse({ ok: false, error: "subject + html are required" }, 400)
  }
  if (body.action === "send_scheduled" && !body.scheduledAt) {
    return jsonResponse({ ok: false, error: "scheduledAt required when action=send_scheduled" }, 400)
  }

  const audienceId = body.audienceId || Deno.env.get("RESEND_NEWSLETTER_AUDIENCE_ID") || DEFAULT_AUDIENCE_ID
  const from = body.from || Deno.env.get("RESEND_NEWSLETTER_FROM") || DEFAULT_FROM
  const name = body.name || body.subject

  // Step 1: Create the Broadcast in Resend.
  // For send_scheduled: pair scheduled_at with send:true — Resend's
  // /broadcasts POST requires this combination to actually queue
  // the broadcast for future delivery (otherwise scheduled_at is
  // ignored and the broadcast sits in draft state).
  const createPayload: Record<string, unknown> = {
    audience_id: audienceId, from, subject: body.subject, html: body.html, name,
  }
  if (body.text) createPayload.text = body.text
  if (body.replyTo) createPayload.reply_to = body.replyTo
  if (body.action === "send_scheduled" && body.scheduledAt) {
    createPayload.scheduled_at = body.scheduledAt
    createPayload.send = true
  }

  const create = await resend<{ id?: string; statusCode?: number; message?: string }>(
    apiKey, "POST", "/broadcasts", createPayload,
  )
  if (!create.ok || !create.body?.id) {
    return jsonResponse({
      ok: false, step: "create_broadcast",
      status: create.status, body: create.body,
    }, 502)
  }
  const broadcastId = create.body.id
  console.log(`[newsletter-send] created broadcast id=${broadcastId} action=${body.action} audience=${audienceId}`)

  if (body.action === "send") {
    const send = await resend<{ id?: string; statusCode?: number; message?: string }>(
      apiKey, "POST", `/broadcasts/${broadcastId}/send`, {},
    )
    if (!send.ok) {
      return jsonResponse({
        ok: false, step: "send_broadcast",
        broadcast_id: broadcastId, status: send.status, body: send.body,
      }, 502)
    }
    console.log(`[newsletter-send] sent broadcast id=${broadcastId}`)
  }

  return jsonResponse({
    ok: true, action: body.action, broadcast_id: broadcastId, audience_id: audienceId,
    scheduled_at: body.action === "send_scheduled" ? body.scheduledAt : null,
    note: body.action === "dry_run"
      ? "Broadcast created without sending. Preview + send manually in Resend UI if approved."
      : body.action === "send_scheduled"
      ? `Scheduled. Resend will deliver at ${body.scheduledAt}.`
      : "Send queued. Delivery typically within 1-3 minutes.",
  })
})
