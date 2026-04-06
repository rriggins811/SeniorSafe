import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, ChevronLeft, Clock, Users, Copy, Share2, Sparkles, Shield, AlertTriangle, Heart, User } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getAppUrl, copyToClipboard } from '../lib/platform'
import { generateFamilyCode } from '../lib/familyCode'

// Time options: 30-min increments from 6 AM to 8 PM
const TIME_OPTIONS = []
for (let h = 6; h <= 20; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 20 && m > 0) break
    const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h
    const ampm = h >= 12 ? 'PM' : 'AM'
    const label = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    TIME_OPTIONS.push({ label, value })
  }
}

// Step offsets and totals per path (signup steps already completed)
// +2 for medical disclaimer + emergency interstitial shown before path-specific steps
const PATH_CONFIG = {
  'parent-setup': { signupSteps: 1, onboardingSteps: 5, total: 6 },
  'member-join':  { signupSteps: 2, onboardingSteps: 3, total: 5 },
  'self-setup':   { signupSteps: 1, onboardingSteps: 5, total: 6 },
  'oauth':        { signupSteps: 0, onboardingSteps: 6, total: 6 },
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const path = searchParams.get('path') || 'parent-setup'
  const config = PATH_CONFIG[path] || PATH_CONFIG['parent-setup']

  const [user, setUser] = useState(null)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Check-in time (default 9 AM)
  const [checkinTime, setCheckinTime] = useState('09:00')

  // Check-in demo
  const [checkedIn, setCheckedIn] = useState(false)
  const [checkInLoading, setCheckInLoading] = useState(false)

  // Family code
  const [codeCopied, setCodeCopied] = useState(false)

  // OAuth profile fields (only used for oauth path)
  const [oauthForm, setOauthForm] = useState({ firstName: '', lastName: '', setupType: '' })
  const [oauthFamilyCode, setOauthFamilyCode] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { navigate('/signin'); return }
      setUser(user)
      supabase
        .from('user_profile')
        .select('onboarding_complete')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.onboarding_complete) navigate('/dashboard', { replace: true })
        })
    })
  }, [navigate])

  const meta = user?.user_metadata || {}
  const seniorName = oauthForm.firstName || meta.first_name || 'your loved one'
  const familyCode = oauthFamilyCode || meta.family_code || ''

  function displayStep() {
    return config.signupSteps + step + 1
  }

  function goBack() {
    if (step > 0) setStep(s => s - 1)
  }

  // ─── Check-in demo ────────────────────────────────────────────────
  async function handleDemoCheckIn() {
    if (!user || checkedIn || checkInLoading) return
    setCheckInLoading(true)
    await supabase.from('checkins').insert({
      user_id: user.id,
      family_name: meta.family_name || '',
      checked_in_at: new Date().toISOString(),
    })
    setCheckInLoading(false)
    setCheckedIn(true)
  }

  // ─── Copy family code ─────────────────────────────────────────────
  async function handleCopyCode() {
    await copyToClipboard(familyCode)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  // ─── Share family code ─────────────────────────────────────────────
  async function handleShare() {
    const appUrl = getAppUrl()
    const url = `${appUrl}/signup?code=${familyCode}`
    const text = `Join ${seniorName}'s family on SeniorSafe! Use code ${familyCode} or tap this link: ${url}`

    if (navigator.share) {
      try { await navigator.share({ title: 'Join SeniorSafe', text }) } catch { /* cancelled */ }
    } else {
      await copyToClipboard(text)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    }
  }

  // ─── Save profile and finish (admin paths) ────────────────────────
  // Profile already exists (created in SignUpPage). Update with onboarding data.
  async function handleFinish() {
    if (!user) return
    setSaving(true)

    const { error } = await supabase.from('user_profile')
      .update({
        checkin_alert_time: checkinTime,
        onboarding_complete: true,
      })
      .eq('user_id', user.id)

    setSaving(false)
    if (error) {
      alert('Error saving profile: ' + error.message)
    } else {
      navigate('/dashboard')
    }
  }

  // ─── Finish for member path ────────────────────────────────────────
  async function handleMemberFinish() {
    if (!user) return
    setSaving(true)

    await supabase
      .from('user_profile')
      .update({ onboarding_complete: true })
      .eq('user_id', user.id)

    setSaving(false)
    navigate('/dashboard')
  }

  // ─── OAuth: create profile and proceed ─────────────────────────────
  async function handleOauthCreateProfile() {
    if (!user || !oauthForm.firstName.trim()) return
    setSaving(true)

    const code = await generateFamilyCode()
    const familyName = oauthForm.lastName.trim()
      ? `The ${oauthForm.lastName.trim()} Family`
      : `${oauthForm.firstName.trim()}'s Family`

    await supabase.from('user_profile').upsert({
      user_id: user.id,
      first_name: oauthForm.firstName.trim(),
      last_name: oauthForm.lastName.trim(),
      family_name: familyName,
      role: 'admin',
      family_code: code,
      senior_name: oauthForm.firstName.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      onboarding_complete: false,
      subscription_tier: 'trial',
      trial_status: 'active',
      trial_start_date: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    setOauthFamilyCode(code)
    setSaving(false)
    setStep(3) // advance past the name collection step
  }

  // ─── OAuth: final save ─────────────────────────────────────────────
  async function handleOauthFinish() {
    if (!user) return
    setSaving(true)

    await supabase.from('user_profile')
      .update({
        checkin_alert_time: checkinTime,
        onboarding_complete: true,
      })
      .eq('user_id', user.id)

    setSaving(false)
    navigate('/dashboard')
  }

  if (!user) return null

  // ═════════════════════════════════════════════════════════════════════
  //  SHARED STEPS: Medical Disclaimer + Emergency Interstitial
  //  These show for ALL paths before path-specific steps
  // ═════════════════════════════════════════════════════════════════════

  // Step 0: Medical Disclaimer
  if (step === 0) {
    return (
      <Shell displayStep={displayStep()} total={config.total} onBack={null}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Shield size={32} color="#1B365D" strokeWidth={1.5} />
          </div>
          <h1 className="text-[#1B365D] font-bold text-2xl">
            Before You Begin
          </h1>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <p className="text-[#1B365D] text-base leading-relaxed">
            SeniorSafe is a family coordination tool. It is <strong>not</strong> a medical device, does not provide medical advice, and is not intended to diagnose, treat, cure, or prevent any medical condition.
          </p>
          <p className="text-[#1B365D] text-base leading-relaxed mt-3">
            Always consult a qualified healthcare provider for medical concerns.
          </p>
        </div>

        <BigButton onClick={() => setStep(1)}>I Understand</BigButton>
      </Shell>
    )
  }

  // Step 1: Emergency Service Interstitial
  if (step === 1) {
    return (
      <Shell displayStep={displayStep()} total={config.total} onBack={() => setStep(0)}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
            <AlertTriangle size={32} color="#DC2626" strokeWidth={1.5} />
          </div>
          <h1 className="text-[#1B365D] font-bold text-2xl">
            Important
          </h1>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <p className="text-gray-800 text-base leading-relaxed">
            SeniorSafe is <strong>NOT</strong> an emergency monitoring service. Our check-in system helps families stay connected, but it does not replace 911, medical alert systems, or in-person care.
          </p>
          <p className="text-red-700 text-base leading-relaxed mt-3 font-semibold">
            If someone is in danger, call 911 immediately.
          </p>
        </div>

        <BigButton onClick={() => setStep(2)}>I Understand</BigButton>
      </Shell>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PATH A: Parent Setup — Onboarding Steps (offset by 2 for disclaimers)
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'parent-setup') {
    // Step 2 — Set check-in time
    if (step === 2) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <Clock size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-2xl">
              Set {seniorName}'s check-in time
            </h1>
            <p className="text-gray-500 text-lg leading-relaxed">
              What time should {seniorName} tap "I'm Okay" each morning?
            </p>
          </div>

          <select
            value={checkinTime}
            onChange={e => setCheckinTime(e.target.value)}
            className="w-full px-4 py-5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-semibold text-xl bg-white"
          >
            {TIME_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <p className="text-[#1B365D]/70 text-base bg-[#1B365D]/5 rounded-xl p-4 text-center">
            If {seniorName} doesn't check in by this time, your family will be notified.
          </p>

          <BigButton onClick={() => setStep(3)}>Next</BigButton>
        </Shell>
      )
    }

    // Step 3 — Try the first check-in
    if (step === 3) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-3 text-center">
            {!checkedIn ? (
              <>
                <h1 className="text-[#1B365D] font-bold text-2xl">
                  Try the first check-in
                </h1>
                <p className="text-gray-500 text-lg leading-relaxed">
                  Hand the phone to {seniorName} and let them try it — one tap!
                </p>

                <div className="w-full mt-4">
                  <button
                    onClick={handleDemoCheckIn}
                    disabled={checkInLoading}
                    className="w-full rounded-2xl py-8 flex flex-col items-center gap-3 bg-[#1B365D] shadow-lg active:scale-[0.97] transition-transform"
                  >
                    <CheckCircle size={48} color="#D4A843" strokeWidth={1.5} />
                    <span className="text-white font-bold text-2xl">
                      {checkInLoading ? 'Checking in...' : "I'm Okay Today"}
                    </span>
                    <span className="text-white/60 text-base">
                      Tap to let your family know you're doing well
                    </span>
                  </button>
                </div>

                <p className="text-gray-400 text-sm mt-2">
                  Go ahead — hand them the phone and let them tap it!
                </p>
              </>
            ) : (
              <>
                {/* Celebration */}
                <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle size={56} color="#16A34A" strokeWidth={2} />
                </div>
                <h1 className="text-green-700 font-bold text-2xl mt-2">
                  Perfect!
                </h1>
                <p className="text-gray-600 text-xl leading-relaxed">
                  {seniorName} is all set.
                </p>
                <p className="text-gray-400 text-base mt-1">
                  They just need to do this once a day.
                </p>
              </>
            )}
          </div>

          {checkedIn && (
            <BigButton onClick={() => setStep(4)}>Next</BigButton>
          )}
        </Shell>
      )
    }

    // Step 4 — Show family code
    if (step === 4) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#D4A843]/20 flex items-center justify-center">
              <Sparkles size={32} color="#D4A843" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-2xl">
              Now set up YOUR account
            </h1>
            <p className="text-gray-500 text-lg leading-relaxed">
              Open SeniorSafe on <strong>your</strong> phone and use this code to join {seniorName}'s family.
            </p>
          </div>

          {/* Large code display */}
          <div className="bg-[#F5F5F5] rounded-2xl p-6 flex flex-col items-center gap-4">
            <p className="text-sm text-gray-500 font-medium uppercase tracking-wider">Family Code</p>
            <p className="text-4xl font-bold tracking-[0.25em] text-[#1B365D]">
              {familyCode}
            </p>

            <div className="flex gap-3 w-full">
              <button
                onClick={handleCopyCode}
                className="flex-1 py-3 rounded-xl bg-[#1B365D] text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <Copy size={18} />
                {codeCopied ? 'Copied!' : 'Copy Code'}
              </button>
              <button
                onClick={handleShare}
                className="flex-1 py-3 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <Share2 size={18} />
                Share
              </button>
            </div>
          </div>

          <div className="bg-[#1B365D]/5 rounded-xl p-4 flex flex-col gap-2">
            <p className="text-[#1B365D] font-semibold text-base">What happens next:</p>
            <p className="text-gray-600 text-base">
              You'll get notified every time {seniorName} checks in — and if they don't check in on time.
            </p>
          </div>

          <BigButton onClick={handleFinish} disabled={saving}>
            {saving ? 'Saving...' : 'Done'}
          </BigButton>
        </Shell>
      )
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PATH B: Member Join — Onboarding Step (offset by 2 for disclaimers)
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'member-join') {
    const adminSeniorName = meta.family_name || `${seniorName}'s family`
    return (
      <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
        <div className="flex flex-col items-center gap-4 text-center pt-4">
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle size={56} color="#16A34A" strokeWidth={2} />
          </div>
          <h1 className="text-[#1B365D] font-bold text-2xl">
            You're connected!
          </h1>
          <p className="text-gray-600 text-xl">
            Welcome to <strong>{adminSeniorName}</strong>
          </p>
        </div>

        <div className="bg-[#F5F5F5] rounded-2xl p-5 flex flex-col gap-4">
          <p className="text-[#1B365D] font-semibold text-base">Here's what you'll get:</p>
          <div className="flex flex-col gap-3">
            <FeatureRow emoji="✓" text="Daily check-in notifications" />
            <FeatureRow emoji="✓" text="Family message board" />
            <FeatureRow emoji="✓" text="Shared document vault" />
            <FeatureRow emoji="✓" text="Medication & appointment tracking" />
            <FeatureRow emoji="✓" text="Emergency alerts" />
          </div>
        </div>

        <BigButton onClick={handleMemberFinish} disabled={saving}>
          {saving ? 'Loading...' : 'Get Started'}
        </BigButton>
      </Shell>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PATH C: Self Setup — Onboarding Steps (offset by 2 for disclaimers)
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'self-setup') {
    // Step 2 — Set check-in time
    if (step === 2) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <Clock size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-2xl">
              Set your daily check-in time
            </h1>
            <p className="text-gray-500 text-lg leading-relaxed">
              What time would you like to check in each morning?
            </p>
          </div>

          <select
            value={checkinTime}
            onChange={e => setCheckinTime(e.target.value)}
            className="w-full px-4 py-5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-semibold text-xl bg-white"
          >
            {TIME_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <p className="text-[#1B365D]/70 text-base bg-[#1B365D]/5 rounded-xl p-4 text-center">
            If you haven't checked in by this time, your family will be notified.
          </p>

          <BigButton onClick={() => setStep(3)}>Next</BigButton>
        </Shell>
      )
    }

    // Step 3 — Invite your family
    if (step === 3) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <Users size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-2xl">
              Invite your family
            </h1>
            <p className="text-gray-500 text-lg leading-relaxed">
              Share this code with your children so they can check on you.
            </p>
          </div>

          {/* Large code display */}
          <div className="bg-[#F5F5F5] rounded-2xl p-6 flex flex-col items-center gap-4">
            <p className="text-sm text-gray-500 font-medium uppercase tracking-wider">Your Family Code</p>
            <p className="text-4xl font-bold tracking-[0.25em] text-[#1B365D]">
              {familyCode}
            </p>

            <div className="flex gap-3 w-full">
              <button
                onClick={handleCopyCode}
                className="flex-1 py-3 rounded-xl bg-[#1B365D] text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <Copy size={18} />
                {codeCopied ? 'Copied!' : 'Copy Code'}
              </button>
              <button
                onClick={handleShare}
                className="flex-1 py-3 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <Share2 size={18} />
                Share
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <BigButton onClick={() => setStep(4)}>Next</BigButton>
            <button
              onClick={() => setStep(4)}
              className="w-full py-4 rounded-xl bg-gray-100 text-gray-500 font-semibold text-lg"
            >
              I'll do this later
            </button>
          </div>
        </Shell>
      )
    }

    // Step 4 — Try your first check-in
    if (step === 4) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-3 text-center">
            {!checkedIn ? (
              <>
                <h1 className="text-[#1B365D] font-bold text-2xl">
                  Try your first check-in
                </h1>
                <p className="text-gray-500 text-lg leading-relaxed">
                  This is what you'll do every morning — one tap!
                </p>

                <div className="w-full mt-4">
                  <button
                    onClick={handleDemoCheckIn}
                    disabled={checkInLoading}
                    className="w-full rounded-2xl py-8 flex flex-col items-center gap-3 bg-[#1B365D] shadow-lg active:scale-[0.97] transition-transform"
                  >
                    <CheckCircle size={48} color="#D4A843" strokeWidth={1.5} />
                    <span className="text-white font-bold text-2xl">
                      {checkInLoading ? 'Checking in...' : "I'm Okay Today"}
                    </span>
                    <span className="text-white/60 text-base">
                      Tap to let your family know you're doing well
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle size={56} color="#16A34A" strokeWidth={2} />
                </div>
                <h1 className="text-green-700 font-bold text-2xl mt-2">
                  Perfect!
                </h1>
                <p className="text-gray-600 text-xl">
                  You're all set. Just do this once a day.
                </p>
              </>
            )}
          </div>

          {checkedIn && (
            <BigButton onClick={handleFinish} disabled={saving}>
              {saving ? 'Saving...' : 'Go to Dashboard'}
            </BigButton>
          )}
        </Shell>
      )
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PATH: OAuth (Apple / Google) — no email/password, collect name
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'oauth') {
    // Steps 0 & 1 are medical disclaimer + emergency interstitial (handled above)

    // Step 2 — Collect name
    if (step === 2) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <User size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-2xl">
              Tell us about yourself
            </h1>
            <p className="text-gray-500 text-lg">
              Just a couple quick things to get you set up.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-2">First name</label>
              <input
                type="text"
                value={oauthForm.firstName}
                onChange={e => setOauthForm(f => ({ ...f, firstName: e.target.value }))}
                placeholder="e.g. Margaret"
                className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl text-lg focus:outline-none focus:border-[#1B365D]"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-2">Last name</label>
              <input
                type="text"
                value={oauthForm.lastName}
                onChange={e => setOauthForm(f => ({ ...f, lastName: e.target.value }))}
                placeholder="e.g. Johnson"
                className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl text-lg focus:outline-none focus:border-[#1B365D]"
              />
            </div>
          </div>

          <BigButton onClick={handleOauthCreateProfile} disabled={saving || !oauthForm.firstName.trim()}>
            {saving ? 'Saving...' : 'Continue'}
          </BigButton>
        </Shell>
      )
    }

    // Step 3 — Set check-in time
    if (step === 3) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <Clock size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-2xl">
              Set your daily check-in time
            </h1>
            <p className="text-gray-500 text-lg leading-relaxed">
              What time should the daily check-in happen?
            </p>
          </div>

          <select
            value={checkinTime}
            onChange={e => setCheckinTime(e.target.value)}
            className="w-full px-4 py-5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-semibold text-xl bg-white"
          >
            {TIME_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <p className="text-[#1B365D]/70 text-base bg-[#1B365D]/5 rounded-xl p-4 text-center">
            If no one checks in by this time, your family will be notified.
          </p>

          <BigButton onClick={() => setStep(4)}>Next</BigButton>
        </Shell>
      )
    }

    // Step 4 — Try the first check-in
    if (step === 4) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-3 text-center">
            {!checkedIn ? (
              <>
                <h1 className="text-[#1B365D] font-bold text-2xl">
                  Try the first check-in
                </h1>
                <p className="text-gray-500 text-lg leading-relaxed">
                  This is what it looks like every morning — one tap!
                </p>

                <div className="w-full mt-4">
                  <button
                    onClick={handleDemoCheckIn}
                    disabled={checkInLoading}
                    className="w-full rounded-2xl py-8 flex flex-col items-center gap-3 bg-[#1B365D] shadow-lg active:scale-[0.97] transition-transform"
                  >
                    <CheckCircle size={48} color="#D4A843" strokeWidth={1.5} />
                    <span className="text-white font-bold text-2xl">
                      {checkInLoading ? 'Checking in...' : "I'm Okay Today"}
                    </span>
                    <span className="text-white/60 text-base">
                      Tap to let your family know you're doing well
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle size={56} color="#16A34A" strokeWidth={2} />
                </div>
                <h1 className="text-green-700 font-bold text-2xl mt-2">
                  Perfect!
                </h1>
                <p className="text-gray-600 text-xl">
                  You're all set. Just do this once a day.
                </p>
              </>
            )}
          </div>

          {checkedIn && (
            <BigButton onClick={() => setStep(5)}>Next</BigButton>
          )}
        </Shell>
      )
    }

    // Step 5 — Show family code
    if (step === 5) {
      return (
        <Shell displayStep={displayStep()} total={config.total} onBack={goBack}>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#D4A843]/20 flex items-center justify-center">
              <Sparkles size={32} color="#D4A843" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-2xl">
              Invite your family
            </h1>
            <p className="text-gray-500 text-lg leading-relaxed">
              Share this code so family members can join.
            </p>
          </div>

          <div className="bg-[#F5F5F5] rounded-2xl p-6 flex flex-col items-center gap-4">
            <p className="text-sm text-gray-500 font-medium uppercase tracking-wider">Family Code</p>
            <p className="text-4xl font-bold tracking-[0.25em] text-[#1B365D]">
              {familyCode}
            </p>

            <div className="flex gap-3 w-full">
              <button
                onClick={handleCopyCode}
                className="flex-1 py-3 rounded-xl bg-[#1B365D] text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <Copy size={18} />
                {codeCopied ? 'Copied!' : 'Copy Code'}
              </button>
              <button
                onClick={handleShare}
                className="flex-1 py-3 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <Share2 size={18} />
                Share
              </button>
            </div>
          </div>

          <BigButton onClick={handleOauthFinish} disabled={saving}>
            {saving ? 'Saving...' : 'Done'}
          </BigButton>
        </Shell>
      )
    }
  }

  return null
}

// ═════════════════════════════════════════════════════════════════════════
//  Shared UI Components
// ═════════════════════════════════════════════════════════════════════════

function Shell({ displayStep, total, onBack, children }) {
  const pct = (displayStep / total) * 100
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-[#1B365D] flex-shrink-0">
        <div className="px-6 pt-12 pb-4 max-w-md mx-auto w-full flex items-center justify-between">
          {onBack ? (
            <button onClick={onBack} className="p-2 -ml-2 rounded-lg text-white/70 active:text-white">
              <ChevronLeft size={24} />
            </button>
          ) : (
            <div className="w-8" />
          )}
          <span className="text-[#D4A843] text-sm font-semibold">
            Step {displayStep} of {total}
          </span>
          <div className="w-8" />
        </div>
        <div className="w-full h-1 bg-white/20">
          <div className="h-full bg-[#D4A843] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 pt-8 pb-10 max-w-md mx-auto w-full flex flex-col gap-6 overflow-y-auto keyboard-safe-bottom">
        {children}
      </div>
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

function FeatureRow({ emoji, text }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-green-600 font-bold text-lg">{emoji}</span>
      <span className="text-gray-700 text-base">{text}</span>
    </div>
  )
}
