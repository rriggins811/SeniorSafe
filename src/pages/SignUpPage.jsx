import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'

function generateFamilyCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase()
}

export default function SignUpPage() {
  const navigate = useNavigate()
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

  const hasInvite = form.inviteCode.trim().length > 0

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
    let family_code = generateFamilyCode()
    let invited_by = null
    let resolvedFamilyName = form.familyName.trim()

    // Validate invite code if provided
    if (hasInvite) {
      const { data: adminProfile, error: lookupErr } = await supabase
        .from('user_profile')
        .select('user_id, family_name, family_code')
        .eq('family_code', form.inviteCode.trim().toUpperCase())
        .single()

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

    setLoading(false)

    if (signUpError) {
      setError(signUpError.message)
    } else {
      navigate('/onboarding')
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">

        {/* Header */}
        <div className="flex flex-col items-center gap-2">
          <div className="bg-[#1B365D] rounded-2xl p-3">
            <Shield size={32} color="#D4A843" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-[#1B365D]">Create your account</h1>
          <p className="text-sm text-gray-500 text-center">Join SeniorSafe and get your family organized.</p>
        </div>

        {/* Form */}
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

          {/* Family name — hide when invite code is entered (will use admin's name) */}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone <span className="text-gray-400 font-normal">(optional — for SMS notifications)</span>
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

          {/* Divider */}
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
              <p className="text-[#1B365D] text-xs mt-1.5">
                ✓ You'll join an existing family account
              </p>
            )}
          </div>

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg mt-1 disabled:opacity-60"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-sm text-center text-gray-500">
          Already have an account?{' '}
          <Link to="/signin" className="text-[#1B365D] font-semibold underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
