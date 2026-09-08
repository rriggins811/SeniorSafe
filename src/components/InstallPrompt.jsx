import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, X, Share } from 'lucide-react'

// The "add to home screen" nudge for the web app. Rules (2026-09-08):
// only on the family's home screen, never on the senior's screen, and once
// dismissed it stays dismissed on that device.

const DISMISS_KEY = 'pwa-install-dismissed'
const SENIOR_KEY = 'ss-senior-screen'
const SENIOR_EVENT = 'ss-senior-screen'

// ParentHome calls this so the banner knows the senior is looking.
export function setSeniorScreen(on) {
  try {
    if (on) sessionStorage.setItem(SENIOR_KEY, '1')
    else sessionStorage.removeItem(SENIOR_KEY)
  } catch { /* storage blocked; the banner just stays quiet */ }
  window.dispatchEvent(new CustomEvent(SENIOR_EVENT, { detail: !!on }))
}

function isSeniorScreen() {
  try { return sessionStorage.getItem(SENIOR_KEY) === '1' } catch { return false }
}

function wasDismissed() {
  try { return !!localStorage.getItem(DISMISS_KEY) } catch { return false }
}

// Detect iOS Safari (not Chrome/Firefox on iOS, not already in standalone mode)
function isIOSSafari() {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua)
  return isIOS && isSafari
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
}

export default function InstallPrompt() {
  const location = useLocation()
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showAndroidBanner, setShowAndroidBanner] = useState(false)
  const [showIOSBanner, setShowIOSBanner] = useState(false)
  const [senior, setSenior] = useState(isSeniorScreen)

  useEffect(() => {
    const onSenior = (e) => setSenior(!!e.detail)
    window.addEventListener(SENIOR_EVENT, onSenior)
    return () => window.removeEventListener(SENIOR_EVENT, onSenior)
  }, [])

  useEffect(() => {
    // Already installed as PWA, or dismissed before: never show it again
    if (isStandalone() || wasDismissed()) return

    // Android/Chrome: listen for native install prompt
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowAndroidBanner(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS Safari: show manual instructions banner (deferred to avoid synchronous setState in effect)
    if (isIOSSafari()) {
      queueMicrotask(() => setShowIOSBanner(true))
    }

    // Hide if installed
    const installedHandler = () => {
      setShowAndroidBanner(false)
      setShowIOSBanner(false)
      setDeferredPrompt(null)
    }
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShowAndroidBanner(false)
    }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShowAndroidBanner(false)
    setShowIOSBanner(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
  }

  // Only the family's home screen gets the nudge. Signup, onboarding, the
  // invite link, Maggie, and every senior screen stay clean.
  if (location.pathname !== '/dashboard' || senior) return null

  // Android/Chrome native install banner
  if (showAndroidBanner) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-[#1B365D] text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Download size={20} className="text-[#D4A843] shrink-0" />
          <p className="text-sm truncate">
            Install SeniorSafe for quick access
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <button
            onClick={handleInstall}
            className="bg-[#D4A843] text-[#1B365D] px-3 py-1 rounded-lg text-sm font-semibold"
          >
            Install
          </button>
          <button onClick={handleDismiss} className="p-1" aria-label="Not now">
            <X size={18} />
          </button>
        </div>
      </div>
    )
  }

  // iOS Safari manual install instructions
  if (showIOSBanner) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#1B365D] text-white px-4 py-3 shadow-lg safe-area-bottom">
        <div className="flex items-start gap-3">
          <Share size={20} className="text-[#D4A843] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Put SeniorSafe on your home screen</p>
            <p className="text-xs text-white/80 mt-1 leading-relaxed">
              Tap <strong>Share</strong> <span className="inline-flex items-center"><Share size={11} className="mx-0.5" /></span> at the bottom of Safari, then tap <strong>Add to Home Screen</strong>. You only need to do this once.
            </p>
          </div>
          <button onClick={handleDismiss} className="p-1 shrink-0" aria-label="Not now">
            <X size={18} />
          </button>
        </div>
      </div>
    )
  }

  return null
}
