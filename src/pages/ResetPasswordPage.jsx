import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dismissKeyboard } from '../lib/dismissKeyboard'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  // Supabase handles the token exchange automatically when the user
  // clicks the email link — it sets a session via onAuthStateChange.
  // We wait for that session before showing the form.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(true)
      }
    })
    // Also check if already signed in (e.g. page reload)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    dismissKeyboard()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
      setTimeout(() => navigate('/dashboard'), 3000)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">

        <div className="flex flex-col items-center gap-2">
          <div className="bg-[#1B365D] rounded-2xl p-3">
            <Shield size={32} color="#D4A843" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-[#1B365D]">
            {success ? 'Password Updated' : 'Set New Password'}
          </h1>
          <p className="text-sm text-gray-500 text-center">
            {success
              ? "You're all set! Redirecting to your dashboard..."
              : 'Choose a new password for your SeniorSafe account.'}
          </p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle size={48} className="text-green-500" />
            <p className="text-green-700 text-sm font-medium">Your password has been changed successfully.</p>
          </div>
        ) : !sessionReady ? (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">Verifying your reset link...</p>
            <p className="text-gray-400 text-xs mt-2">If this takes more than a few seconds, the link may have expired. Go back to Sign In and request a new one.</p>
            <button
              onClick={() => navigate('/signin')}
              className="mt-4 text-[#1B365D] text-sm font-semibold hover:underline"
            >
              Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg disabled:opacity-60"
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
