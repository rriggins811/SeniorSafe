import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  SITE, SUPPORT, TAG_DECLINED, TAG_PARTNER, TAG_REQUEST, TYPE_LABELS,
  RULES_TEXT, SIGNATURE_TEXT, emailHtml, escapeHtml, firstName, formatPhone, fromSupport,
  ghlTags, pageHtml, rulesHtml, sendEmail, signatureHtml, whenEastern,
} from "../_shared/partners.ts"

// partner-review: the page Ryan opens from the "Partner request" email
// (partner co-branding, Level 1, 2026-09-12). Public, verify_jwt false; the
// single-use review_token is the credential. GET shows the request with
// Approve and Decline buttons (a form POST, so a mail scanner that follows
// the link cannot approve anything). Approve flips the row live and sends the
// kit email. Decline removes the row and its logo and sends nothing; Ryan
// writes those himself.

const COLS = "code, name, logo_url, phone, tagline, partner_type, contact_name, contact_email, requested_at, terms_version, ghl_contact_id"

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })
}

function usedPage() {
  return html(pageHtml("Link used", `<h1>This link has been used, or is not valid.</h1><p>Approved and declined requests cannot be reopened from the email. If something needs to change, write <a href="mailto:${SUPPORT}">${SUPPORT}</a> or fix the row in the partners table.</p>`), 404)
}

function details(p: any): string {
  return `<div class="card">` +
    (p.logo_url ? `<img class="logo" src="${escapeHtml(p.logo_url)}" alt="logo">` : "") +
    `<table>` +
    `<tr><td>Business</td><td><b>${escapeHtml(p.name)}</b></td></tr>` +
    `<tr><td>Code</td><td><code>${escapeHtml(p.code)}</code></td></tr>` +
    `<tr><td>Type</td><td>${escapeHtml(TYPE_LABELS[p.partner_type] || p.partner_type)}</td></tr>` +
    `<tr><td>Phone shown</td><td>${escapeHtml(formatPhone(p.phone))}</td></tr>` +
    `<tr><td>Their line</td><td>${p.tagline ? escapeHtml(p.tagline) : "(none)"}</td></tr>` +
    `<tr><td>Contact</td><td>${escapeHtml(p.contact_name || "")}, <a href="mailto:${escapeHtml(p.contact_email || "")}">${escapeHtml(p.contact_email || "")}</a></td></tr>` +
    `<tr><td>Requested</td><td>${escapeHtml(whenEastern(p.requested_at))}</td></tr>` +
    `<tr><td>Terms</td><td>accepted, version ${escapeHtml(p.terms_version || "")}</td></tr>` +
    `</table></div>`
}

serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  let token = ""
  let action = ""
  if (req.method === "GET") {
    token = new URL(req.url).searchParams.get("token") || ""
  } else if (req.method === "POST") {
    try {
      const form = await req.formData()
      token = String(form.get("token") ?? "").trim()
      action = String(form.get("action") ?? "").trim()
    } catch { return html(pageHtml("Bad request", "<h1>Bad request.</h1>"), 400) }
  } else {
    return html(pageHtml("Not found", "<h1>Nothing here.</h1>"), 404)
  }
  if (!/^[0-9a-f]{48}$/.test(token)) return usedPage()

  const { data: p } = await supabase.from("partners").select(COLS)
    .eq("review_token", token).eq("active", false).maybeSingle()
  if (!p) return usedPage()

  // ---- GET: show it ----
  if (req.method === "GET") {
    return html(pageHtml(`Review: ${p.name}`,
      `<h1>Partner request: ${escapeHtml(p.name)}</h1>` +
      details(p) +
      `<div class="card">` +
      `<p style="margin:0 0 12px"><b>Approve</b> makes the code live, tags the GHL contact <code>${TAG_PARTNER}</code>, and emails ${escapeHtml(p.contact_email || "them")} their link, QR code and flyer (bcc ${SUPPORT}). ` +
      `<b>Decline</b> removes the request and the logo and sends nothing; write them yourself if you want to.</p>` +
      `<div class="actions">` +
      `<form method="post"><input type="hidden" name="token" value="${token}"><input type="hidden" name="action" value="approve"><button class="approve" type="submit">Approve and send their kit</button></form>` +
      `<form method="post" onsubmit="return confirm('Decline ${escapeHtml(p.name).replace(/'/g, "\\'")}? The request is removed and no email goes out.')"><input type="hidden" name="token" value="${token}"><input type="hidden" name="action" value="decline"><button class="decline" type="submit">Decline</button></form>` +
      `</div></div>` +
      `<p class="muted">Not sure? Close this page; the link keeps working until you use it. The partner terms they accepted: <a href="${SITE}/partners/terms">${SITE}/partners/terms</a>.</p>`,
    ))
  }

  // ---- POST approve ----
  if (action === "approve") {
    const { data: live, error } = await supabase.from("partners")
      .update({ active: true, approved_at: new Date().toISOString(), review_token: null })
      .eq("review_token", token).eq("active", false).select(COLS).maybeSingle()
    if (error || !live) return usedPage()

    if (live.ghl_contact_id) await ghlTags(live.ghl_contact_id, [TAG_PARTNER], [TAG_REQUEST])

    const code = live.code
    const first = firstName(live.contact_name || "")
    const phoneNice = formatPhone(live.phone)
    const link = `${SITE}/p/${code}`
    const qr = `${SITE}/p/${code}/qr.png`
    const flyer = `${SITE}/p/${code}/flyer`

    const text = [
      `Hi ${first},`,
      ``,
      `${live.name} is set up. From now on, a family that signs up through your link or enters your code sees "Shared by ${live.name}" with your logo on their screen, and on Mom's screen, every day they open the app.`,
      ``,
      `Your link: ${link}`,
      `Your QR code (a PNG, print it anywhere): ${qr}`,
      `Your flyer (open it, then print or save as PDF): ${flyer}`,
      `Your code: ${code}`,
      ``,
      `The link and the flyer go live within a few minutes of this email.`,
      ``,
      `How to hand it out:`,
      `- Put the QR code on your intake packet, your front desk, your email signature.`,
      `- Tell a family: "Install Hammock365 from the App Store or Google Play and enter the code ${code} when you sign up." Or they scan the QR and sign up in the browser.`,
      `- The Call button on their screen rings ${phoneNice}.`,
      ``,
      `Once five or more families have signed up through your code, you get a monthly note with counts only. Never names, never details.`,
      ``,
      RULES_TEXT,
      ``,
      `Need to change your logo, phone or line? Reply to this email.`,
      ``,
      SIGNATURE_TEXT,
    ].join("\n")
    const body = emailHtml(
      `<p style="margin:0 0 14px">Hi ${escapeHtml(first)},</p>` +
      `<p style="margin:0 0 14px"><b>${escapeHtml(live.name)}</b> is set up. From now on, a family that signs up through your link or enters your code sees &ldquo;Shared by ${escapeHtml(live.name)}&rdquo; with your logo on their screen, and on Mom&rsquo;s screen, every day they open the app.</p>` +
      `<table style="border-collapse:collapse;font-size:15px;margin:0 0 14px">` +
      `<tr><td style="padding:4px 12px 4px 0;color:#6B645A">Your link</td><td><a href="${link}" style="color:#1F5A4B">${link}</a></td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#6B645A">Your QR code</td><td><a href="${qr}" style="color:#1F5A4B">${qr}</a></td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#6B645A">Your flyer</td><td><a href="${flyer}" style="color:#1F5A4B">${flyer}</a> (open it, then print or save as PDF)</td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#6B645A">Your code</td><td><code style="font-weight:700;color:#1F5A4B;background:#F4E7CF;padding:1px 6px;border-radius:6px">${escapeHtml(code)}</code></td></tr>` +
      `</table>` +
      `<p style="margin:0 0 14px"><img src="${qr}" alt="Your QR code" width="180" height="180" style="display:block;border:1px solid #E6DFD0;border-radius:10px"></p>` +
      `<p style="margin:0 0 14px;font-size:14px;color:#6B645A">The link and the flyer go live within a few minutes of this email.</p>` +
      `<p style="margin:0 0 6px"><b>How to hand it out</b></p>` +
      `<ul style="margin:0 0 14px;padding-left:22px">` +
      `<li>Put the QR code on your intake packet, your front desk, your email signature.</li>` +
      `<li>Tell a family: &ldquo;Install Hammock365 from the App Store or Google Play and enter the code <b>${escapeHtml(code)}</b> when you sign up.&rdquo; Or they scan the QR and sign up in the browser.</li>` +
      `<li>The Call button on their screen rings ${escapeHtml(phoneNice)}.</li>` +
      `</ul>` +
      `<p style="margin:0">Once five or more families have signed up through your code, you get a monthly note with counts only. Never names, never details.</p>` +
      rulesHtml() +
      `<p style="margin:18px 0 0">Need to change your logo, phone or line? Reply to this email.</p>` +
      signatureHtml(),
    )
    const sent = await sendEmail({
      from: fromSupport(), to: [live.contact_email], bcc: [SUPPORT], reply_to: SUPPORT,
      subject: `Your Hammock365 partner code is live: ${code}`, text, html: body,
    })
    console.log(`partner-review approved ${code} kit=${sent}`)

    return html(pageHtml(`Approved: ${live.name}`,
      `<h1>Approved. ${escapeHtml(live.name)} is live.</h1>` +
      `<div class="card"><p style="margin:0 0 10px">${sent ? `The kit email went to ${escapeHtml(live.contact_email)} (bcc ${SUPPORT}).` : `<b>The kit email did NOT send</b> (Resend error; check the partner-review log). Send them the links below by hand.`}</p>` +
      `<table><tr><td>Link</td><td><a href="${link}">${link}</a></td></tr><tr><td>QR</td><td><a href="${qr}">${qr}</a></td></tr><tr><td>Flyer</td><td><a href="${flyer}">${flyer}</a></td></tr></table>` +
      `<p class="muted" style="margin:12px 0 0">The landing page and flyer can take up to five minutes to appear (the site caches partner lookups).</p></div>`,
    ))
  }

  // ---- POST decline ----
  if (action === "decline") {
    const logoPath = (p.logo_url || "").split("/partner-logos/")[1]
    const { error } = await supabase.from("partners").delete().eq("review_token", token).eq("active", false)
    if (error) return html(pageHtml("Error", `<h1>Could not remove the row.</h1><p>${escapeHtml(error.message)}</p>`), 500)
    if (logoPath) await supabase.storage.from("partner-logos").remove([decodeURIComponent(logoPath)])
    if (p.ghl_contact_id) await ghlTags(p.ghl_contact_id, [TAG_DECLINED], [TAG_REQUEST])
    console.log(`partner-review declined ${p.code}`)
    return html(pageHtml(`Declined: ${p.name}`,
      `<h1>Declined. ${escapeHtml(p.name)} was removed.</h1>` +
      `<div class="card"><p style="margin:0">No email went to ${escapeHtml(p.contact_email || "them")}. The GHL contact is tagged <code>${TAG_DECLINED}</code> so the note you write finds them. The code <code>${escapeHtml(p.code)}</code> is free again.</p></div>`,
    ))
  }

  return html(pageHtml("Bad request", "<h1>Bad request.</h1>"), 400)
})
