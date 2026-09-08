// A one-bit flag: is the senior looking at the screen right now? ParentHome
// sets it; the web install banner reads it and stays hidden.

const SENIOR_KEY = 'ss-senior-screen'
export const SENIOR_EVENT = 'ss-senior-screen'

export function setSeniorScreen(on) {
  try {
    if (on) sessionStorage.setItem(SENIOR_KEY, '1')
    else sessionStorage.removeItem(SENIOR_KEY)
  } catch { /* storage blocked; the banner just stays quiet */ }
  window.dispatchEvent(new CustomEvent(SENIOR_EVENT, { detail: !!on }))
}

export function isSeniorScreen() {
  try { return sessionStorage.getItem(SENIOR_KEY) === '1' } catch { return false }
}
