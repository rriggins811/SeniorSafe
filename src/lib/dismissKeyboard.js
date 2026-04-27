// Programmatically blur the active element so iOS dismisses the keyboard
// before the submit/click handler runs. Without this, an iOS WebView
// intercepts the first tap to dismiss the keyboard, and the user has to
// tap a second time to actually trigger the button. Major friction for
// seniors. Call this at the top of every form submit handler and any
// submit-style onClick that's reachable while a text input is focused.
export function dismissKeyboard() {
  if (typeof document === 'undefined') return
  const el = document.activeElement
  if (el && typeof el.blur === 'function') el.blur()
}
