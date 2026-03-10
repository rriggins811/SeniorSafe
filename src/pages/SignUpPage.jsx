import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateFamilyCode } from '../lib/familyCode'

// ─── Member signup (invited via URL ?code=XXXXXX) ─────────────────────────
function MemberSignup({ urlCode }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    inviteCode: urlCode,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const code = form.inviteCode.trim().toUpperCase()

    // Validate invite code (secure RPC — no anon access to user_profile)
    const { data: lookupRows, error: lookupErr } = await supabase
      .rpc('lookup_invite_code', { invite_code: code })

    const adminProfile = lookupRows?.[0] ?? null

    if (lookupErr || !adminProfile) {
      setError('Invite code not found. Double-check the code and try again.')
      setLoading(false)
      return
    }

    // Create account
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          family_name: adminProfile.family_name,
          phone: form.phone.trim(),
          role: 'member',
          invited_by: adminProfile.user_id,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Create user_profile directly — skip onboarding
    await supabase.from('user_profile').upsert({
      user_id: data.user.id,
      family_name: adminProfile.family_name,
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      phone: form.phone.trim() || null,
      role: 'member',
      invited_by: adminProfile.user_id,
      family_code: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      onboarding_complete: true,
    }, { onConflict: 'user_id' })

    setLoading(false)
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">

        <div className="flex flex-col items-center gap-2">
          <div className="bg-[#1B365D] rounded-2xl p-3">
            <Shield size={32} color="#D4A843" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-[#1B365D] text-center">Join Your Family on SeniorSafe</h1>
          <p className="text-sm text-gray-500 text-center leading-relaxed">
            You've been invited to connect with your family. Create your account to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input
                name="firstName"
                type="text"
                required
                value={form.firstName}
                onChange={handleChange}
                placeholder="Jane"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input
                name="lastName"
                type="text"
                required
                value={form.lastName}
                onChange={handleChange}
                placeholder="Smith"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              value={form.email}
              onChange={handleChange}
              placeholder="jane@example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mobile phone <span className="text-gray-400 font-normal">(for notifications)</span>
            </label>
            <input
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              placeholder="(336) 555-0100"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={handleChange}
              placeholder="At least 6 characters"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Family invite code</label>
            <input
              name="inviteCode"
              type="text"
              required
              value={form.inviteCode}
              onChange={e => setForm({ ...form, inviteCode: e.target.value.toUpperCase() })}
              placeholder="e.g. A3BX7K"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D] uppercase tracking-widest"
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg mt-1 disabled:opacity-60"
          >
            {loading ? 'Creating account...' : 'Join Family'}
          </button>
        </form>

        <p className="text-sm text-center text-gray-500">
          Already have an account?{' '}
          <Link to="/signin" className="text-[#1B365D] font-semibold underline">Sign in</Link>
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

// ─── Admin signup (no invite code in URL) ─────────────────────────────────
export default function SignUpPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlCode = searchParams.get('code')?.toUpperCase() || ''

  // All hooks must be called before any conditional return
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    familyName: '',
    phone: '',
    inviteCode: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // If URL has invite code, show member flow (after all hooks)
  if (urlCode) return <MemberSignup urlCode={urlCode} />

  const hasInvite = form.inviteCode.trim().length > 0

  async function handleGoogleSignUp() {
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    })
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
  }

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!hasInvite && !form.familyName.trim()) {
      setError('Please enter your family name or a family invite code.')
      return
    }

    setLoading(true)

    let role = 'admin'
    let family_code = await generateFamilyCode()
    let invited_by = null
    let resolvedFamilyName = form.familyName.trim()

    // Validate invite code if provided (secure RPC — no anon access to user_profile)
    if (hasInvite) {
      const { data: lookupRows, error: lookupErr } = await supabase
        .rpc('lookup_invite_code', { invite_code: form.inviteCode.trim() })

      const adminProfile = lookupRows?.[0] ?? null

      if (lookupErr || !adminProfile) {
        setError('Invite code not found. Double-check the code and try again.')
        setLoading(false)
        return
      }

      role = 'member'
      family_code = null
      invited_by = adminProfile.user_id
      resolvedFamilyName = adminProfile.family_name
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
          family_name: resolvedFamilyName,
          phone: form.phone.trim(),
          role,
          family_code,
          invited_by,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
    } else if (role === 'member') {
      // Member via invite code in admin form — create profile, skip onboarding
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('user_profile').upsert({
          user_id: user.id,
          family_name: resolvedFamilyName,
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          phone: form.phone.trim() || null,
          role: 'member',
          invited_by,
          family_code: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          onboarding_complete: true,
        }, { onConflict: 'user_id' })
      }
      setLoading(false)
      navigate('/dashboard')
    } else {
      setLoading(false)
      navigate('/onboarding')
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">

        <div className="flex flex-col items-center gap-2">
          <div className="bg-[#1B365D] rounded-2xl p-3">
            <Shield size={32} color="#D4A843" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-[#1B365D]">Create your account</h1>
          <p className="text-sm text-gray-500 text-center">Join SeniorSafe and get your family organized.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input
                name="firstName"
                type="text"
                required
                value={form.firstName}
                onChange={handleChange}
                placeholder="Jane"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input
                name="lastName"
                type="text"
                required
                value={form.lastName}
                onChange={handleChange}
                placeholder="Smith"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mobile phone <span className="text-gray-400 font-normal">(for SMS notifications)</span>
            </label>
            <input
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              placeholder="(336) 555-0100"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              value={form.email}
              onChange={handleChange}
              placeholder="jane@example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={handleChange}
              placeholder="At least 6 characters"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
            />
          </div>

          {!hasInvite && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Family name</label>
              <input
                name="familyName"
                type="text"
                value={form.familyName}
                onChange={handleChange}
                placeholder="e.g. The Johnson Family"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D]"
              />
            </div>
          )}

          <div className="border-t border-gray-100 pt-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Family invite code{' '}
              <span className="text-gray-400 font-normal">(if someone invited you)</span>
            </label>
            <input
              name="inviteCode"
              type="text"
              value={form.inviteCode}
              onChange={e => setForm({ ...form, inviteCode: e.target.value.toUpperCase() })}
              placeholder="e.g. A3BX7K"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:border-[#1B365D] uppercase tracking-widest"
            />
            {hasInvite && (
              <p className="text-[#1B365D] text-xs mt-1.5">✓ You'll join an existing family account</p>
            )}
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg mt-1 disabled:opacity-60"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogleSignUp}
          disabled={googleLoading}
          className="w-full py-4 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold text-base flex items-center justify-center gap-3 hover:bg-gray-50 disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
          </svg>
          {googleLoading ? 'Redirecting...' : 'Continue with Google'}
        </button>

        <p className="text-sm text-center text-gray-500">
          Already have an account?{' '}
          <Link to="/signin" className="text-[#1B365D] font-semibold underline">Sign in</Link>
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
