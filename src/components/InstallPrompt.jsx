import { useState, useEffect } from 'react'
import { Download, X, Share } from 'lucide-react'

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
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showAndroidBanner, setShowAndroidBanner] = useState(false)
  const [showIOSBanner, setShowIOSBanner] = useState(false)

  useEffect(() => {
    // Already installed as PWA — don't show anything
    if (isStandalone()) return

    const dismissed = localStorage.getItem('pwa-install-dismissed')
    const recentlyDismissed = dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000

    // Android/Chrome: listen for native install prompt
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      if (!recentlyDismissed) {
        setShowAndroidBanner(true)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS Safari: show manual instructions banner (deferred to avoid synchronous setState in effect)
    if (isIOSSafari() && !recentlyDismissed) {
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
    localStorage.setItem('pwa-install-dismissed', Date.now().toString())
  }

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
          <button onClick={handleDismiss} className="p-1">
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
            <p className="text-sm font-semibold">Install SeniorSafe on your iPhone</p>
            <p className="text-xs text-white/80 mt-1">
              Tap the <span className="inline-flex items-center"><Share size={12} className="mx-0.5" /></span> Share button below, then tap <strong>"Add to Home Screen"</strong>
            </p>
          </div>
          <button onClick={handleDismiss} className="p-1 shrink-0">
            <X size={18} />
          </button>
        </div>
      </div>
    )
  }

  return null
}
