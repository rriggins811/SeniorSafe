import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Shield, ChevronLeft, Heart, Users, User, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateFamilyCode } from '../lib/familyCode'
import { isNative } from '../lib/platform'

const NATIVE_REDIRECT = 'com.rigginsstrategicsolutions.seniorsafe://auth/callback'

function getOAuthRedirect() {
  return isNative() ? NATIVE_REDIRECT : window.location.origin + '/dashboard'
}

export default function SignUpPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlCode = searchParams.get('code')?.toUpperCase() || ''

  const [path, setPath] = useState(urlCode ? 'member-join' : null)
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [adminProfile, setAdminProfile] = useState(null)
  const [codeValidating, setCodeValidating] = useState(!!urlCode)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    age: '',
    email: '',
    password: '',
    phone: '',
    inviteCode: urlCode,
    relationship: '',
  })

  // Auto-validate URL invite code on mount
  useEffect(() => {
    if (!urlCode) return
    ;(async () => {
      const { data: rows } = await supabase.rpc('lookup_invite_code', { invite_code: urlCode })
      const profile = rows?.[0]
      setCodeValidating(false)
      if (profile) {
        setAdminProfile(profile)
        setStep(1)
      } else {
        setError('This invite code is no longer valid. Ask your family member for a new one.')
      }
    })()
  }, [urlCode])

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  function goBack() {
    setError('')
    if (step > 0) {
      setStep(s => s - 1)
    } else {
      setPath(null)
      setAdminProfile(null)
      setForm(f => ({ ...f, inviteCode: '' }))
    }
  }

  async function handleGoogleSignUp() {
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getOAuthRedirect() },
    })
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
  }

  async function handleAppleSignUp() {
    setAppleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: getOAuthRedirect() },
    })
    if (error) {
      setError(error.message)
      setAppleLoading(false)
    }
  }

  function selectPath(p) {
    setPath(p)
    setStep(0)
    setError('')
    setForm({
      firstName: '', lastName: '', age: '', email: '', password: '',
      phone: '', inviteCode: '', relationship: '',
    })
  }

  // ─── Code validation for Path B ───────────────────────────────────
  async function handleValidateCode() {
    const code = form.inviteCode.trim().toUpperCase()
    if (code.length < 4) { setError('Please enter a valid family code.'); return }

    setLoading(true)
    const { data: rows, error: err } = await supabase.rpc('lookup_invite_code', { invite_code: code })
    setLoading(false)

    const profile = rows?.[0]
    if (err || !profile) {
      setError('Code not found. Check with your family member and try again.')
      return
    }
    setAdminProfile(profile)
    setStep(1)
  }

  // ─── Create admin account (Path A + C) ────────────────────────────
  async function createAdminAccount() {
    if (!form.firstName.trim() || !form.email.trim() || !form.password) {
      setError('Please fill in all fields.')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    setError('')

    const familyCode = await generateFamilyCode()
    const familyName = form.lastName.trim()
      ? `The ${form.lastName.trim()} Family`
      : `${form.firstName.trim()}'s Family`

    const { data, error: err } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          family_name: familyName,
          phone: form.phone.trim() || null,
          role: 'admin',
          family_code: familyCode,
          senior_name: form.firstName.trim(),
          senior_age: parseInt(form.age) || null,
          onboarding_path: path,
        },
      },
    })

    if (err) { setError(err.message); setLoading(false); return }

    // Create user_profile immediately so family_code is in the DB
    // before it's displayed on the onboarding family code screen.
    // OnboardingPage handleFinish() will update with checkin_alert_time later.
    if (data?.user) {
      await supabase.from('user_profile').upsert({
        user_id: data.user.id,
        family_name: familyName,
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        phone: form.phone.trim() || null,
        role: 'admin',
        family_code: familyCode,
        senior_name: form.firstName.trim(),
        senior_age: parseInt(form.age) || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        onboarding_complete: false,
      }, { onConflict: 'user_id' })
    }

    setLoading(false)
    navigate(`/onboarding?path=${path}`)
  }

  // ─── Create member account (Path B) ───────────────────────────────
  async function createMemberAccount() {
    if (!form.firstName.trim() || !form.email.trim() || !form.password) {
      setError('Please fill in all required fields.')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    setError('')

    const { data, error: err } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          family_name: adminProfile.family_name,
          phone: form.phone.trim() || null,
          role: 'member',
          invited_by: adminProfile.user_id,
          relationship: form.relationship || null,
          onboarding_path: 'member-join',
        },
      },
    })

    if (err) { setError(err.message); setLoading(false); return }

    if (data?.user) {
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
        onboarding_complete: false,
      }, { onConflict: 'user_id' })
    }

    setLoading(false)
    navigate('/onboarding?path=member-join')
  }

  // ─── Loading state for URL code validation ────────────────────────
  if (codeValidating) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <Loader2 size={32} className="animate-spin text-[#1B365D]" />
        <p className="text-gray-500">Checking your invite code...</p>
      </div>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  LANDING SCREEN — choose your path
  // ═════════════════════════════════════════════════════════════════════
  if (!path) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="bg-[#1B365D] rounded-2xl p-4">
              <Shield size={40} color="#D4A843" strokeWidth={1.5} />
            </div>
            <h1 className="text-2xl font-bold text-[#1B365D] text-center">
              Welcome to SeniorSafe
            </h1>
            <p className="text-gray-500 text-center text-lg leading-relaxed">
              How would you like to get started?
            </p>
          </div>

          {/* Path A — Primary (most common) */}
          <button
            onClick={() => selectPath('parent-setup')}
            className="w-full p-6 rounded-2xl bg-[#1B365D] text-left flex items-start gap-4 active:scale-[0.98] transition-transform"
          >
            <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <Heart size={28} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div className="pt-1">
              <p className="text-white font-bold text-lg leading-snug">
                Setting up for my parent
              </p>
              <p className="text-white/60 text-sm mt-1">
                I'm on my parent's phone right now
              </p>
            </div>
          </button>

          {/* Path B — Secondary */}
          <button
            onClick={() => selectPath('member-join')}
            className="w-full p-5 rounded-2xl border-2 border-[#1B365D] text-left flex items-start gap-4 active:scale-[0.98] transition-transform"
          >
            <div className="w-14 h-14 rounded-xl bg-[#1B365D]/10 flex items-center justify-center flex-shrink-0">
              <Users size={28} color="#1B365D" strokeWidth={1.5} />
            </div>
            <div className="pt-1">
              <p className="text-[#1B365D] font-bold text-lg leading-snug">
                Joining a family member
              </p>
              <p className="text-gray-500 text-sm mt-1">
                I have an invite code
              </p>
            </div>
          </button>

          {/* Path C — Tertiary */}
          <button
            onClick={() => selectPath('self-setup')}
            className="w-full py-4 rounded-xl text-center active:bg-gray-50 transition-colors"
          >
            <p className="text-[#1B365D] font-semibold text-base flex items-center justify-center gap-2">
              <User size={18} strokeWidth={1.5} />
              Setting up for myself
            </p>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Apple OAuth */}
          <button
            onClick={handleAppleSignUp}
            disabled={appleLoading}
            className="w-full py-4 rounded-xl bg-black text-white font-semibold text-base flex items-center justify-center gap-3 hover:bg-gray-900 disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="white">
              <path d="M14.94 9.63c-.02-2.1 1.71-3.11 1.79-3.16-0.98-1.43-2.49-1.62-3.03-1.65-1.29-.13-2.52.76-3.18.76-.65 0-1.66-.74-2.73-.72-1.4.02-2.7.82-3.42 2.07-1.46 2.53-.37 6.28 1.05 8.34.7 1.01 1.53 2.14 2.62 2.1 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.64.68 2.74.66 1.13-.02 1.85-1.03 2.54-2.04.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.2-.85-2.25-3.32ZM12.86 3.32c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.87 2.56.93.07 1.88-.47 2.45-1.16Z"/>
            </svg>
            {appleLoading ? 'Redirecting...' : 'Sign in with Apple'}
          </button>

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
            {googleLoading ? 'Redirecting...' : 'Sign up with Google'}
          </button>

          <div className="flex flex-col gap-2 pt-2">
            <p className="text-sm text-center text-gray-500">
              Already have an account?{' '}
              <Link to="/signin" className="text-[#1B365D] font-semibold underline">Sign in</Link>
            </p>
            <p className="text-xs text-gray-400 text-center">
              <Link to="/terms" className="underline hover:text-gray-600">Terms</Link>
              {' | '}
              <Link to="/privacy" className="underline hover:text-gray-600">Privacy</Link>
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PATH A — Setting up for my parent
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'parent-setup' && step === 0) {
    return (
      <StepShell step={1} total={4} onBack={goBack}>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
            <Heart size={32} color="#1B365D" strokeWidth={1.5} />
          </div>
          <h1 className="text-[#1B365D] font-bold text-2xl">
            Who is this account for?
          </h1>
          <p className="text-gray-500 text-lg">
            We'll get their phone set up for daily check-ins.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Input label="Parent's first name" placeholder="e.g. Margaret" value={form.firstName}
            onChange={v => update('firstName', v)} autoFocus />
          <Input label="Their age" placeholder="e.g. 78" type="number" inputMode="numeric"
            value={form.age} onChange={v => update('age', v)} />
          <Input label="Last name" placeholder="e.g. Johnson" value={form.lastName}
            onChange={v => update('lastName', v)} />
        </div>

        {form.firstName.trim() && (
          <p className="text-[#1B365D] text-base bg-[#1B365D]/5 rounded-xl p-4 text-center">
            This will be <strong>{form.firstName.trim()}</strong>'s phone — you'll set up your own account next.
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Input label="Email address" placeholder="email@example.com" type="email"
            value={form.email} onChange={v => update('email', v)} />
          <Input label="Create a password" placeholder="At least 6 characters" type="password"
            value={form.password} onChange={v => update('password', v)} />
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <BigButton onClick={createAdminAccount} disabled={loading || !form.firstName.trim() || !form.email.trim() || !form.password}>
          {loading ? 'Creating account...' : 'Create Account & Continue'}
        </BigButton>
      </StepShell>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PATH B — Joining a family member
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'member-join' && step === 0) {
    return (
      <StepShell step={1} total={3} onBack={goBack}>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
            <Users size={32} color="#1B365D" strokeWidth={1.5} />
          </div>
          <h1 className="text-[#1B365D] font-bold text-2xl">
            Enter your family code
          </h1>
          <p className="text-gray-500 text-lg">
            Your family member should have shared this with you.
          </p>
        </div>

        <input
          type="text"
          value={form.inviteCode}
          onChange={e => update('inviteCode', e.target.value.toUpperCase())}
          placeholder="e.g. A3BX7K"
          maxLength={6}
          className="w-full px-6 py-5 border-2 border-gray-200 rounded-2xl text-center text-3xl font-bold tracking-[0.3em] text-[#1B365D] focus:outline-none focus:border-[#1B365D] uppercase"
          autoFocus
        />

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <BigButton onClick={handleValidateCode} disabled={loading || form.inviteCode.trim().length < 4}>
          {loading ? 'Checking...' : 'Continue'}
        </BigButton>
      </StepShell>
    )
  }

  if (path === 'member-join' && step === 1) {
    const seniorName = adminProfile?.senior_name || adminProfile?.first_name || 'your family'
    return (
      <StepShell step={2} total={3} onBack={goBack}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-[#1B365D] font-bold text-2xl">
            Your info
          </h1>
          {adminProfile && (
            <p className="text-gray-500 text-lg">
              You're joining <strong>{adminProfile.family_name || `${seniorName}'s family`}</strong>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Input label="Your first name" placeholder="e.g. Sarah" value={form.firstName}
            onChange={v => update('firstName', v)} autoFocus />
          <Input label="Last name" placeholder="e.g. Johnson" value={form.lastName}
            onChange={v => update('lastName', v)} />
          <Input label="Your phone number" placeholder="(336) 555-0100" type="tel"
            value={form.phone} onChange={v => update('phone', v)}
            hint="For check-in notifications" />

          <div>
            <label className="block text-base font-medium text-gray-700 mb-2">
              Relationship to {seniorName}
            </label>
            <select
              value={form.relationship}
              onChange={e => update('relationship', e.target.value)}
              className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl text-lg focus:outline-none focus:border-[#1B365D] bg-white"
            >
              <option value="">Select...</option>
              <option value="Son">Son</option>
              <option value="Daughter">Daughter</option>
              <option value="Spouse">Spouse</option>
              <option value="Grandchild">Grandchild</option>
              <option value="Caregiver">Caregiver</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="border-t border-gray-100 pt-4 flex flex-col gap-4">
            <Input label="Email address" placeholder="email@example.com" type="email"
              value={form.email} onChange={v => update('email', v)} />
            <Input label="Create a password" placeholder="At least 6 characters" type="password"
              value={form.password} onChange={v => update('password', v)} />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <BigButton onClick={createMemberAccount} disabled={loading || !form.firstName.trim() || !form.email.trim() || !form.password}>
          {loading ? 'Creating account...' : 'Join Family'}
        </BigButton>
      </StepShell>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PATH C — Setting up for myself
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'self-setup' && step === 0) {
    return (
      <StepShell step={1} total={4} onBack={goBack}>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
            <User size={32} color="#1B365D" strokeWidth={1.5} />
          </div>
          <h1 className="text-[#1B365D] font-bold text-2xl">
            Let's get you set up
          </h1>
          <p className="text-gray-500 text-lg">
            We'll have you checking in with your family in no time.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Input label="Your first name" placeholder="e.g. Margaret" value={form.firstName}
            onChange={v => update('firstName', v)} autoFocus />
          <Input label="Last name" placeholder="e.g. Johnson" value={form.lastName}
            onChange={v => update('lastName', v)} />
          <Input label="Your age" placeholder="e.g. 78" type="number" inputMode="numeric"
            value={form.age} onChange={v => update('age', v)} />
        </div>

        <div className="border-t border-gray-100 pt-4 flex flex-col gap-4">
          <Input label="Email address" placeholder="email@example.com" type="email"
            value={form.email} onChange={v => update('email', v)} />
          <Input label="Create a password" placeholder="At least 6 characters" type="password"
            value={form.password} onChange={v => update('password', v)} />
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <BigButton onClick={createAdminAccount} disabled={loading || !form.firstName.trim() || !form.email.trim() || !form.password}>
          {loading ? 'Creating account...' : 'Create Account & Continue'}
        </BigButton>
      </StepShell>
    )
  }

  return null
}

// ═════════════════════════════════════════════════════════════════════════
//  Shared UI Components
// ═════════════════════════════════════════════════════════════════════════

function StepShell({ step, total, onBack, children }) {
  const pct = (step / total) * 100
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header with progress */}
      <div className="bg-[#1B365D] flex-shrink-0">
        <div className="px-6 pt-12 pb-4 max-w-md mx-auto w-full flex items-center justify-between">
          <button onClick={onBack} className="p-2 -ml-2 rounded-lg text-white/70 active:text-white">
            <ChevronLeft size={24} />
          </button>
          <span className="text-[#D4A843] text-sm font-semibold">
            Step {step} of {total}
          </span>
          <div className="w-8" />
        </div>
        <div className="w-full h-1 bg-white/20">
          <div className="h-full bg-[#D4A843] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 pt-8 pb-10 max-w-md mx-auto w-full flex flex-col gap-6 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function Input({ label, hint, onChange, autoFocus, ...props }) {
  return (
    <div>
      <label className="block text-base font-medium text-gray-700 mb-2">{label}</label>
      <input
        {...props}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl text-lg focus:outline-none focus:border-[#1B365D]"
      />
      {hint && <p className="text-gray-400 text-sm mt-1">{hint}</p>}
    </div>
  )
}

function BigButton({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-5 rounded-2xl bg-[#1B365D] text-[#D4A843] font-bold text-xl disabled:opacity-40 active:scale-[0.98] transition-transform mt-2"
    >
      {children}
    </button>
  )
}
