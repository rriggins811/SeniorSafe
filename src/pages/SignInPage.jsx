import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Shield, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function SignInPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Forgot password flow
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      // Check if this user has completed onboarding
      const { data: profile } = await supabase
        .from('user_profile')
        .select('onboarding_complete')
        .eq('user_id', data.user.id)
        .single()
      navigate(profile?.onboarding_complete ? '/dashboard' : '/onboarding')
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    setResetError('')
    if (!resetEmail.trim()) {
      setResetError('Please enter your email address.')
      return
    }
    setResetLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setResetLoading(false)
    if (error) {
      setResetError(error.message)
    } else {
      setResetSent(true)
    }
  }

  // ---------- Forgot password screen ----------
  if (showReset) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div className="flex flex-col items-center gap-2">
            <div className="bg-[#1B365D] rounded-2xl p-3">
              <Shield size={32} color="#D4A843" strokeWidth={1.5} />
            </div>
            <h1 className="text-2xl font-bold text-[#1B365D]">Reset Password</h1>
            <p className="text-sm text-gray-500 text-center">
              {resetSent
                ? "Check your email for a password reset link. It may take a minute to arrive."
                : "Enter your email and we'll send you a link to reset your password."}
            </p>
          </div>

          {!resetSent ? (
            <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
                />
              </div>
              {resetError && (
                <p className="text-red-500 text-sm text-center">{resetError}</p>
              )}
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg disabled:opacity-60"
              >
                {resetLoading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-green-700 text-sm font-medium">Reset link sent!</p>
              <p className="text-green-600 text-xs mt-1">Check your inbox (and spam folder) for an email from SeniorSafe.</p>
            </div>
          )}

          <button
            onClick={() => { setShowReset(false); setResetSent(false); setResetError('') }}
            className="flex items-center justify-center gap-2 text-[#1B365D] text-sm font-semibold"
          >
            <ArrowLeft size={14} /> Back to Sign In
          </button>
        </div>
      </div>
    )
  }

  // ---------- Normal sign in ----------
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">

        {/* Header */}
        <div className="flex flex-col items-center gap-2">
          <div className="bg-[#1B365D] rounded-2xl p-3">
            <Shield size={32} color="#D4A843" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-[#1B365D]">Welcome back</h1>
          <p className="text-sm text-gray-500 text-center">Sign in to your SeniorSafe account.</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
            <div className="text-right mt-1.5">
              <button
                type="button"
                onClick={() => { setShowReset(true); setResetEmail(email) }}
                className="text-xs text-[#1B365D] font-medium hover:underline"
              >
                Forgot password?
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg mt-1 disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-sm text-center text-gray-500">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="text-[#1B365D] font-semibold underline">
            Get started
          </Link>
        </p>

        <p className="text-xs text-gray-400 text-center">
          <Link to="/terms" className="underline hover:text-gray-600">Terms of Service</Link>
          {' | '}
          <Link to="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
