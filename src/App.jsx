import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
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

function ProtectedRoute({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    // "Remember me" session cleanup — if user unchecked "Remember me",
    // sign out when they close and reopen the browser.
    // sessionStorage clears on browser close; localStorage persists.
    const sessionOnly = localStorage.getItem('seniorsafe_session_only')
    const activeTab = sessionStorage.getItem('seniorsafe_active_tab')
    if (sessionOnly && !activeTab) {
      localStorage.removeItem('seniorsafe_session_only')
      supabase.auth.signOut()
      return
    }
    // Mark this tab as active (persists until browser closes)
    if (sessionOnly) {
      sessionStorage.setItem('seniorsafe_active_tab', 'true')
    }

    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  if (!session) return <Navigate to="/signin" replace />
  return children
}

function P({ children }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <InstallPrompt />
      <Routes>
        <Route path="/"            element={<WelcomePage />} />
        <Route path="/signup"      element={<SignUpPage />} />
        <Route path="/signin"      element={<SignInPage />} />
        <Route path="/onboarding"  element={<P><OnboardingPage /></P>} />
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
