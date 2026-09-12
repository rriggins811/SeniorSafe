import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  CODE_RE, PARTNER_TYPES, RESERVED, SITE, SUPPORT, TAG_REQUEST, TERMS_VERSION, TYPE_LABELS,
  RULES_TEXT, SIGNATURE_TEXT, emailHtml, escapeHtml, firstName, formatPhone, fromAlerts, fromSupport,
  ghlTags, ghlUpsert, rulesHtml, sendEmail, signatureHtml, suggestCode, whenEastern,
} from "../_shared/partners.ts"

// partner-apply: the "Get your code" form on hammock365.com/partners/apply
// (partner co-branding, Level 1; Ryan's GO 2026-09-12). Public, verify_jwt
// false: a honeypot field, size limits and a 2 MB logo cap stand in for auth.
//
// Creates a PENDING partner row (active = false, so families never see it),
// uploads the logo to the public partner-logos bucket, tags the GHL contact
// hammock-partner-request, emails the partner an acknowledgement and emails
// support@hammock365.com a single-use review link. partner-review does the
// approve or decline and sends the kit.

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp",
}
const LOGO_MAX = 2 * 1024 * 1024
const ORIGINS = new Set(["https://hammock365.com", "https://www.hammock365.com", "http://localhost:3005", "http://localhost:3000"])

function cors(req: Request) {
  const o = req.headers.get("origin") || ""
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(o) ? o : "https://hammock365.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  }
}

function j(o: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...h, "Content-Type": "application/json" } })
}

serve(async (req: Request) => {
  const h = cors(req)
  if (req.method === "OPTIONS") return new Response("ok", { headers: h })
  if (req.method !== "POST") return j({ error: "POST only" }, 405, h)

  let form: FormData
  try { form = await req.formData() } catch { return j({ error: "Send the form as multipart/form-data." }, 400, h) }
  const s = (k: string) => String(form.get(k) ?? "").trim()

  // Honeypot: real people never see the field. Bots get a quiet "ok".
  if (s("website")) return j({ ok: true }, 200, h)

  const name = s("business_name")
  const contact = s("contact_name")
  const email = s("contact_email").toLowerCase()
  const tagline = s("tagline")
  const type = s("partner_type")
  const code = (s("code").toLowerCase() || suggestCode(name))
  let phone = s("phone").replace(/\D/g, "")
  if (phone.length === 11 && phone.startsWith("1")) phone = phone.slice(1)
  const logo = form.get("logo")

  const errors: string[] = []
  if (name.length < 2 || name.length > 80) errors.push("Business name: 2 to 80 characters.")
  if (contact.length < 2 || contact.length > 80) errors.push("Your name: 2 to 80 characters.")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.push("A working email address.")
  if (phone.length !== 10) errors.push("A 10-digit US phone number families can call.")
  if (tagline.length > 80) errors.push("Your one line: 80 characters max.")
  if (!PARTNER_TYPES.includes(type)) errors.push("Pick the kind of work you do.")
  if (!CODE_RE.test(code) || RESERVED.has(code)) errors.push("Code: 2 to 40 letters, numbers and hyphens, starting with a letter or number.")
  if (s("terms") !== "yes") errors.push("You have to agree to the partner terms.")
  if (!(logo instanceof File) || logo.size === 0) errors.push("Your logo (PNG, JPG, SVG or WebP).")
  else if (!LOGO_TYPES[logo.type]) errors.push("Logo: PNG, JPG, SVG or WebP.")
  else if (logo.size > LOGO_MAX) errors.push("Logo: 2 MB max.")
  if (errors.length) return j({ error: errors.join(" "), errors }, 400, h)
  const logoFile = logo as File

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: taken } = await supabase.from("partners").select("code").eq("code", code).maybeSingle()
  if (taken) return j({ error: `The code "${code}" is taken. Pick another.`, field: "code" }, 409, h)

  const path = `${code}.${LOGO_TYPES[logoFile.type]}`
  const { error: upErr } = await supabase.storage.from("partner-logos")
    .upload(path, await logoFile.arrayBuffer(), { contentType: logoFile.type, upsert: true })
  if (upErr) {
    console.error("partner-apply logo upload", code, upErr.message)
    return j({ error: `The logo upload failed. Try again, or email the file to ${SUPPORT}.` }, 500, h)
  }
  const logoUrl = supabase.storage.from("partner-logos").getPublicUrl(path).data.publicUrl

  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("")
  const now = new Date().toISOString()
  const { error: insErr } = await supabase.from("partners").insert({
    code, name, logo_url: logoUrl, phone, tagline: tagline || null, partner_type: type,
    is_demo: false, active: false, source: "form",
    contact_name: contact, contact_email: email, requested_at: now,
    terms_version: TERMS_VERSION, terms_accepted_at: now, review_token: token,
  })
  if (insErr) {
    if (insErr.code === "23505") return j({ error: `The code "${code}" is taken. Pick another.`, field: "code" }, 409, h)
    console.error("partner-apply insert", code, insErr.message)
    return j({ error: `Something went wrong saving your request. Email ${SUPPORT} and we will set it up by hand.` }, 500, h)
  }

  // GHL: the contact, tagged hammock-partner-request. Never blocks the request.
  const contactId = await ghlUpsert({ email, name: contact, phone, company: name, source: "Hammock365 partner request" })
  if (contactId) {
    await ghlTags(contactId, [TAG_REQUEST], [])
    await supabase.from("partners").update({ ghl_contact_id: contactId }).eq("code", code)
  }

  const reviewUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/partner-review?token=${token}`
  const phoneNice = formatPhone(phone)
  const first = firstName(contact)

  // 1. The partner's acknowledgement.
  const ackText = [
    `Hi ${first},`,
    ``,
    `We got your request for a Hammock365 partner code for ${name}. Ryan reviews every request himself, usually within one business day.`,
    ``,
    `When it is approved you get one more email with:`,
    `- your link, hammock365.com/p/${code}`,
    `- your QR code`,
    `- your one-page flyer, ready to print`,
    ``,
    `What you asked for:`,
    `Business: ${name}`,
    `Code: ${code}`,
    `Phone families should call: ${phoneNice}`,
    tagline ? `Your line: "${tagline}"` : `Your line: (none)`,
    `Type: ${TYPE_LABELS[type] || type}`,
    ``,
    RULES_TEXT,
    ``,
    `Need to change something? Reply to this email.`,
    ``,
    SIGNATURE_TEXT,
  ].join("\n")
  const ackHtml = emailHtml(
    `<p style="margin:0 0 14px">Hi ${escapeHtml(first)},</p>` +
    `<p style="margin:0 0 14px">We got your request for a Hammock365 partner code for <b>${escapeHtml(name)}</b>. Ryan reviews every request himself, usually within one business day.</p>` +
    `<p style="margin:0 0 6px">When it is approved you get one more email with:</p>` +
    `<ul style="margin:0 0 14px;padding-left:22px"><li>your link, hammock365.com/p/${escapeHtml(code)}</li><li>your QR code</li><li>your one-page flyer, ready to print</li></ul>` +
    `<table style="border-collapse:collapse;font-size:15px;margin:0 0 4px">` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Business</td><td>${escapeHtml(name)}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Code</td><td><code style="font-weight:700;color:#1F5A4B">${escapeHtml(code)}</code></td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Phone</td><td>${escapeHtml(phoneNice)}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Your line</td><td>${tagline ? escapeHtml(tagline) : "(none)"}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Type</td><td>${escapeHtml(TYPE_LABELS[type] || type)}</td></tr>` +
    `</table>` +
    rulesHtml() +
    `<p style="margin:18px 0 0">Need to change something? Reply to this email.</p>` +
    signatureHtml(),
  )
  const ackSent = await sendEmail({
    from: fromSupport(), to: [email], reply_to: SUPPORT,
    subject: `Got it: your Hammock365 partner code (${code})`, text: ackText, html: ackHtml,
  })

  // 2. The review email to support@hammock365.com (Ryan, 9/12).
  const reviewHtml = emailHtml(
    `<h2 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;color:#1F5A4B;font-size:22px">Partner request: ${escapeHtml(name)}</h2>` +
    `<img src="${escapeHtml(logoUrl)}" alt="logo" style="max-height:120px;max-width:280px;display:block;margin:0 0 14px">` +
    `<table style="border-collapse:collapse;font-size:15px">` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Code</td><td><code style="font-weight:700;color:#1F5A4B">${escapeHtml(code)}</code></td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Type</td><td>${escapeHtml(TYPE_LABELS[type] || type)}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Phone shown</td><td>${escapeHtml(phoneNice)}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Their line</td><td>${tagline ? escapeHtml(tagline) : "(none)"}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Contact</td><td>${escapeHtml(contact)}, <a href="mailto:${escapeHtml(email)}" style="color:#1F5A4B">${escapeHtml(email)}</a></td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Requested</td><td>${escapeHtml(whenEastern(now))}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">Terms</td><td>accepted, version ${TERMS_VERSION}</td></tr>` +
    `<tr><td style="padding:3px 12px 3px 0;color:#6B645A">GHL</td><td>${contactId ? `contact ${escapeHtml(contactId)}, tagged ${TAG_REQUEST}` : "not synced (check the function log)"}</td></tr>` +
    `</table>` +
    `<p style="margin:22px 0 0"><a href="${reviewUrl}" style="display:inline-block;background:#1F5A4B;color:#F4E7CF;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:10px">Review this request</a></p>` +
    `<p style="margin:14px 0 0;font-size:14px;color:#6B645A">Approve sends them the kit email (link, QR, flyer) on its own and bcc's this inbox. Decline removes the request and sends nothing. The link works once.</p>`,
  )
  const reviewText = [
    `Partner request: ${name} (${code})`,
    `Type: ${TYPE_LABELS[type] || type}`, `Phone shown: ${phoneNice}`, `Their line: ${tagline || "(none)"}`,
    `Contact: ${contact}, ${email}`, `Logo: ${logoUrl}`, `Requested: ${whenEastern(now)}`,
    ``, `Review: ${reviewUrl}`,
    ``, `Approve sends them the kit email on its own. Decline removes the request and sends nothing.`,
  ].join("\n")
  const reviewSent = await sendEmail({
    from: fromAlerts(), to: [SUPPORT], reply_to: email,
    subject: `Partner request: ${name} (${code})`, text: reviewText, html: reviewHtml,
  })
  if (!reviewSent) console.error("partner-apply: review email NOT sent; review by hand:", code, reviewUrl)

  console.log(`partner-apply ok ${code} ack=${ackSent} review=${reviewSent} ghl=${contactId || "none"}`)
  return j({ ok: true, code, site: SITE }, 200, h)
})
