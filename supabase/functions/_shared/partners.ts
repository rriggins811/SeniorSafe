// Shared by partner-apply and partner-review (partner co-branding, Level 1,
// the "Get your code" flow, 2026-09-12). Email goes through Resend like the
// other functions; GHL tagging is additive (upsert without tags, then the tag
// endpoint), copied from trial-ghl-sync. Every partner-facing tag carries the
// hammock- prefix so it never collides with an RSS tag (Ryan, 9/12).

export const SITE = "https://hammock365.com"
export const SUPPORT = "support@hammock365.com"
// The GHL line, so partner calls and texts land in GHL (Ryan, 9/12).
export const PHONE_DISPLAY = "(336) 733-6462"
export const TERMS_VERSION = "2026-09-12"

export const TAG_REQUEST = "hammock-partner-request"
export const TAG_PARTNER = "hammock-partner"
export const TAG_DECLINED = "hammock-partner-declined"

export const CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/
export const RESERVED = new Set(["apply", "terms", "admin", "support", "hammock365", "hammock", "test", "partner", "partners", "demo"])
export const PARTNER_TYPES = ["home_care", "medicare", "senior_living", "assisted_living", "elder_law", "placement", "care_management", "church", "other"]
export const TYPE_LABELS: Record<string, string> = {
  home_care: "Home care agency",
  medicare: "Medicare or insurance agent",
  senior_living: "Senior living community",
  assisted_living: "Assisted living or memory care",
  elder_law: "Elder law or estate attorney",
  placement: "Placement advisor",
  care_management: "Care manager",
  church: "Church or community group",
  other: "Other",
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function formatPhone(p: string | null | undefined): string {
  const d = (p || "").replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return p || ""
}

export function firstName(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || "there"
}

export function suggestCode(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "")
}

export function whenEastern(iso: string | null | undefined): string {
  if (!iso) return ""
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET"
}

// ---------- GHL ----------

const GHL_BASE = "https://services.leadconnectorhq.com"
const GHL_VER = "2021-07-28"

async function ghl(method: string, path: string, body?: unknown) {
  const token = Deno.env.get("GHL_PIT_TOKEN") || ""
  if (!token) return { status: 0, body: null as any }
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VER, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  }
  if (body !== undefined && method !== "GET") {
    ;(init.headers as Record<string, string>)["Content-Type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${GHL_BASE}${path}`, init)
  const text = await res.text()
  let parsed: unknown
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed as any }
}

/** Upsert without tags (upsert-with-tags replaces the whole set). Returns the contact id or null; never throws. */
export async function ghlUpsert(c: { email: string; name: string; phone: string; company: string; source: string }): Promise<string | null> {
  const loc = Deno.env.get("GHL_LOCATION_ID") || ""
  if (!loc) return null
  try {
    const parts = c.name.trim().split(/\s+/)
    const up = await ghl("POST", "/contacts/upsert", {
      locationId: loc,
      email: c.email,
      firstName: parts[0] || undefined,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
      phone: c.phone ? `+1${c.phone}` : undefined,
      companyName: c.company || undefined,
      source: c.source,
    })
    if (up.status < 200 || up.status >= 300) {
      console.error("ghl upsert fail", c.email, up.status, JSON.stringify(up.body))
      return null
    }
    return up.body?.contact?.id || up.body?.id || null
  } catch (e) {
    console.error("ghl upsert threw", e instanceof Error ? e.message : String(e))
    return null
  }
}

/** Additive tagging; never throws. */
export async function ghlTags(contactId: string, add: string[], remove: string[]): Promise<void> {
  try {
    if (add.length) await ghl("POST", `/contacts/${contactId}/tags`, { tags: add })
    if (remove.length) await ghl("DELETE", `/contacts/${contactId}/tags`, { tags: remove })
  } catch (e) {
    console.error("ghl tags threw", e instanceof Error ? e.message : String(e))
  }
}

// ---------- Resend ----------

export function fromSupport(): string {
  return `Hammock365 <${SUPPORT}>`
}

/** The review email to support@ cannot come from support@ itself, so it uses the alerts address like send-feedback. */
export function fromAlerts(): string {
  const addr = Deno.env.get("RESEND_FROM_ADDRESS")?.trim() || "alerts@hammock365.com"
  return `Hammock365 Partners <${addr}>`
}

export async function sendEmail(msg: {
  from: string; to: string[]; reply_to?: string; bcc?: string[]; subject: string; text: string; html: string
}): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY")
  if (!key) { console.error("RESEND_API_KEY missing; not sent:", msg.subject); return false }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) { console.error(`Resend ${res.status} for "${msg.subject}":`, await res.text()); return false }
    return true
  } catch (e) {
    console.error("Resend threw", e instanceof Error ? e.message : String(e))
    return false
  }
}

export const RULES_TEXT =
  `The rules, one more time: it always says "Shared by," never "endorsed by." No money moves in either direction, ever. ` +
  `You never see a family's information. Hammock365 is not an emergency service. Full terms: ${SITE}/partners/terms`

export const SIGNATURE_TEXT = `Ryan Riggins\nHammock365\n${SUPPORT}, ${PHONE_DISPLAY}`

export function rulesHtml(): string {
  return `<p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#6B645A">The rules, one more time: it always says &ldquo;Shared by,&rdquo; never &ldquo;endorsed by.&rdquo; No money moves in either direction, ever. You never see a family&rsquo;s information. Hammock365 is not an emergency service. <a href="${SITE}/partners/terms" style="color:#1F5A4B">Full terms</a>.</p>`
}

export function signatureHtml(): string {
  return `<p style="margin:22px 0 0;font-size:15px;line-height:1.5;color:#2D2A24">Ryan Riggins<br>Hammock365<br><a href="mailto:${SUPPORT}" style="color:#1F5A4B">${SUPPORT}</a>, ${PHONE_DISPLAY}</p>`
}

/** Plain evergreen email shell. */
export function emailHtml(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FAF8F4">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FAF8F4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E6DFD0;border-radius:14px">
<tr><td style="background:#1F5A4B;border-radius:14px 14px 0 0;padding:18px 26px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#F4E7CF;font-weight:700">Hammock365</td></tr>
<tr><td style="padding:24px 26px 28px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#2D2A24">${bodyHtml}</td></tr>
</table>
<p style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6B645A;margin:14px 0 0">Hammock365 is built by Riggins Strategic Solutions, LLC, Greensboro, NC. It is not an emergency service.</p>
</td></tr></table></body></html>`
}

/** Plain evergreen page shell for the review screens. */
export function pageHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title>
<style>
  body{margin:0;background:#FAF8F4;color:#2D2A24;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5}
  .band{background:#1F5A4B;color:#F4E7CF;padding:16px 20px;font-family:Georgia,"Times New Roman",serif;font-size:20px;font-weight:700}
  .wrap{max-width:640px;margin:0 auto;padding:22px 18px 48px}
  h1{font-family:Georgia,"Times New Roman",serif;color:#1F5A4B;font-size:26px;line-height:1.15;margin:0 0 14px}
  .card{background:#fff;border:1px solid #E6DFD0;border-radius:14px;padding:18px 20px;margin:0 0 16px}
  .logo{max-height:120px;max-width:280px;object-fit:contain;display:block;margin:0 0 12px}
  table{border-collapse:collapse;width:100%;font-size:15px}
  td{padding:5px 10px 5px 0;vertical-align:top}
  td:first-child{color:#6B645A;white-space:nowrap;width:1%}
  code{font-family:Menlo,Consolas,monospace;font-weight:700;color:#1F5A4B;background:#F4E7CF;padding:1px 6px;border-radius:6px}
  .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
  button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:14px 20px;cursor:pointer}
  .approve{background:#1F5A4B;color:#F4E7CF}
  .decline{background:#fff;color:#7A2E2E;border:2px solid #E6DFD0}
  .muted{color:#6B645A;font-size:14px}
  a{color:#1F5A4B}
</style></head><body><div class="band">Hammock365 partners</div><div class="wrap">${bodyHtml}</div></body></html>`
}
