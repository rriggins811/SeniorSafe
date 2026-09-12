// Ad attribution for the Hammock365 web/PWA path.
// Captures the Meta click id (fbclid) + UTM params from the landing URL on first
// load and stores them (first-touch) in localStorage, then writes them onto
// user_profile.signup_source at signup. Answers "did this signup come from our
// ad?" without any external dependency. Added 2026-05-29.

const KEYS = ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const STORAGE_KEY = 'ss_attribution'
const PARTNER_KEY = 'h365_partner'
const PARTNER_CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/

// Partner co-branding (2026-09-12). hammock365.com/p/<code> sends a family to
// /signup?partner=<code>. The code waits here until signup writes it onto the
// owner's profile. Its own key, first-touch: an ad click never overwrites a
// partner and a partner never overwrites an ad click.
export function capturePartner() {
  try {
    if (typeof window === 'undefined') return
    const code = (new URLSearchParams(window.location.search).get('partner') || '').trim().toLowerCase()
    if (!PARTNER_CODE_RE.test(code)) return
    if (localStorage.getItem(PARTNER_KEY)) return
    localStorage.setItem(PARTNER_KEY, JSON.stringify({ code, captured_at: new Date().toISOString() }))
  } catch {
    /* best-effort only */
  }
}

export function getPartnerCode() {
  try {
    if (typeof window === 'undefined') return null
    const raw = localStorage.getItem(PARTNER_KEY)
    return raw ? (JSON.parse(raw).code || null) : null
  } catch {
    return null
  }
}

export function captureAttribution() {
  capturePartner()
  try {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const found = {}
    for (const k of KEYS) {
      const v = params.get(k)
      if (v) found[k] = v
    }
    if (Object.keys(found).length === 0) return
    // First-touch: preserve the original ad click; do not overwrite on later visits.
    if (localStorage.getItem(STORAGE_KEY)) return
    found.referrer = document.referrer || null
    found.landing_url = window.location.href
    found.captured_at = new Date().toISOString()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(found))
  } catch {
    /* best-effort only — never block the app on attribution */
  }
}

export function getAttribution() {
  try {
    if (typeof window === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
