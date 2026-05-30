// Ad attribution for the SeniorSafe web/PWA path.
// Captures the Meta click id (fbclid) + UTM params from the landing URL on first
// load and stores them (first-touch) in localStorage, then writes them onto
// user_profile.signup_source at signup. Answers "did this signup come from our
// ad?" without any external dependency. Added 2026-05-29.

const KEYS = ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const STORAGE_KEY = 'ss_attribution'

export function captureAttribution() {
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
