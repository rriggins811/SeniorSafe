import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import WelcomePage from './pages/WelcomePage'
import SignUpPage from './pages/SignUpPage'
import SignInPage from './pages/SignInPage'
import OnboardingPage from './pages/OnboardingPage'
import DashboardPage from './pages/DashboardPage'
import VaultPage from './pages/VaultPage'
import AIPage from './pages/AIPage'
import ContactPage from './pages/ContactPage'
import MedicationsPage from './pages/MedicationsPage'
import AppointmentsPage from './pages/AppointmentsPage'
import FamilyPage from './pages/FamilyPage'
import EmergencyPage from './pages/EmergencyPage'
import FamilyInvitePage from './pages/FamilyInvitePage'
import ProfilePage from './pages/ProfilePage'
import TermsPage from './pages/TermsPage'
import PrivacyPage from './pages/PrivacyPage'
import UpgradePage from './pages/UpgradePage'
import SupportPage from './pages/SupportPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import InstallPrompt from './components/InstallPrompt'
import ErrorBoundary from './components/ErrorBoundary'
import { isNative } from './lib/platform'
import { initializePurchases } from './utils/purchases'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'

function ProtectedRoute({ children, skipOnboardingCheck }) {
  const [session, setSession] = useState(undefined)
  const [onboardingChecked, setOnboardingChecked] = useState(skipOnboardingCheck || false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  useEffect(() => {
    const sessionOnly = localStorage.getItem('seniorsafe_session_only')
    const activeTab = sessionStorage.getItem('seniorsafe_active_tab')
    if (sessionOnly && !activeTab) {
      localStorage.removeItem('seniorsafe_session_only')
      supabase.auth.signOut()
      return
    }
    if (sessionOnly) {
      sessionStorage.setItem('seniorsafe_active_tab', 'true')
    }

    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  // Check if user has completed onboarding (for OAuth users who skip SignUpPage)
  useEffect(() => {
    if (!session || skipOnboardingCheck || onboardingChecked) return
    supabase
      .from('user_profile')
      .select('onboarding_complete')
      .eq('user_id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!data || !data.onboarding_complete) {
          setNeedsOnboarding(true)
        }
        setOnboardingChecked(true)
      })
  }, [session, skipOnboardingCheck, onboardingChecked])

  if (session === undefined) return null
  if (!session) return <Navigate to="/signin" replace />
  if (!skipOnboardingCheck && !onboardingChecked) return null
  if (needsOnboarding) {
    const provider = session.user.app_metadata?.provider
    const isOAuth = provider === 'apple' || provider === 'google'
    const onboardingPath = isOAuth ? 'oauth' : 'parent-setup'
    return <Navigate to={`/onboarding?path=${onboardingPath}`} replace />
  }
  return children
}

function P({ children, skipOnboardingCheck }) {
  return <ProtectedRoute skipOnboardingCheck={skipOnboardingCheck}>{children}</ProtectedRoute>
}

export default function App() {
  // iOS keyboard: let the OS handle it natively, just dismiss on tap outside
  useEffect(() => {
    if (!isNative()) return

    Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {})

    const handleTouchStart = (e) => {
      const tag = e.target.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !e.target.isContentEditable) {
        Keyboard.hide().catch(() => {})
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    return () => document.removeEventListener('touchstart', handleTouchStart)
  }, [])

  useEffect(() => {
    initializePurchases().catch((err) => console.warn('RevenueCat init skipped:', err))

    // Listen for deep link callbacks (OAuth redirect from system browser)
    if (isNative()) {
      const handleDeepLink = async ({ url }) => {
        // Close the system browser after OAuth completes
        try { await Browser.close() } catch {}

        // Handle auth callback: extract tokens from URL fragment
        if (url.includes('auth/callback')) {
          // Tokens can be in hash fragment (#access_token=...) or query params (?access_token=...)
          const hashParams = new URLSearchParams(url.split('#')[1] || '')
          const queryParams = new URLSearchParams(url.split('?')[1]?.split('#')[0] || '')
          const accessToken = hashParams.get('access_token') || queryParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token')

          if (accessToken && refreshToken) {
            const { data: { session } } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })

            // Route OAuth users: check if they have a profile / completed onboarding
            if (session?.user) {
              const { data: profile } = await supabase
                .from('user_profile')
                .select('onboarding_complete')
                .eq('user_id', session.user.id)
                .single()

              if (profile?.onboarding_complete) {
                window.location.replace('/dashboard')
              } else {
                // Determine onboarding path from provider
                const provider = session.user.app_metadata?.provider
                const isOAuth = provider === 'apple' || provider === 'google'
                window.location.replace(isOAuth ? '/onboarding?path=oauth' : '/onboarding')
              }
            }
          }
        }
      }
      CapApp.addListener('appUrlOpen', handleDeepLink)
      return () => { CapApp.removeAllListeners() }
    }
  }, [])

  return (
    <ErrorBoundary>
    <BrowserRouter>
      {!isNative() && <InstallPrompt />}
      <Routes>
        <Route path="/"            element={<WelcomePage />} />
        <Route path="/signup"      element={<SignUpPage />} />
        <Route path="/signin"      element={<SignInPage />} />
        <Route path="/onboarding"  element={<P skipOnboardingCheck><OnboardingPage /></P>} />
        <Route path="/dashboard"   element={<P><DashboardPage /></P>} />
        <Route path="/vault"       element={<P><VaultPage /></P>} />
        <Route path="/ai"          element={<P><AIPage /></P>} />
        <Route path="/contact"     element={<P><ContactPage /></P>} />
        <Route path="/medications" element={<P><MedicationsPage /></P>} />
        <Route path="/appointments" element={<P><AppointmentsPage /></P>} />
        <Route path="/family"      element={<P><FamilyPage /></P>} />
        <Route path="/emergency"   element={<P><EmergencyPage /></P>} />
        <Route path="/family-invite" element={<P><FamilyInvitePage /></P>} />
        <Route path="/profile"       element={<P><ProfilePage /></P>} />
        <Route path="/upgrade"       element={<P><UpgradePage /></P>} />
        <Route path="/support"       element={<P><SupportPage /></P>} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/terms"         element={<TermsPage />} />
        <Route path="/privacy"       element={<PrivacyPage />} />
        <Route path="*" element={
          <div className="min-h-screen bg-[#F5F5F5] flex flex-col items-center justify-center px-6 text-center gap-4">
            <p className="text-6xl font-bold text-[#1B365D]">404</p>
            <p className="text-gray-500 text-lg">Page not found</p>
            <Link to="/dashboard" className="mt-2 px-6 py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold">
              Go to Dashboard
            </Link>
          </div>
        } />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
