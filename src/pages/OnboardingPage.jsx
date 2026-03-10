import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, ChevronLeft, Clock, Users, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateFamilyCode } from '../lib/familyCode'
import { sendSMS } from '../lib/sms'

const TOTAL = 3

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

function detectPlatform() {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1: Check-in time
  const [checkinTime, setCheckinTime] = useState('10:00')

  // Step 2: Invite family member
  const [inviteName, setInviteName] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteSent, setInviteSent] = useState(false)
  const [inviteError, setInviteError] = useState('')

  // Step 3: platform detection
  const [platform] = useState(detectPlatform)

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

  async function handleSaveTime() {
    // Save check-in time immediately
    if (user) {
      await supabase
        .from('user_profile')
        .update({ checkin_alert_time: checkinTime })
        .eq('user_id', user.id)
    }
    setStep(1)
  }

  async function handleSendInvite() {
    if (!inviteName.trim() || !invitePhone.trim()) return
    setInviteSending(true)
    setInviteError('')

    try {
      // Ensure admin has a family_code
      const { data: profile } = await supabase
        .from('user_profile')
        .select('family_code')
        .eq('user_id', user.id)
        .single()

      let code = profile?.family_code
      if (!code) {
        code = await generateFamilyCode()
        await supabase
          .from('user_profile')
          .update({ family_code: code })
          .eq('user_id', user.id)
      }

      // Send SMS invite
      const firstName = user.user_metadata?.first_name || user.user_metadata?.family_name || 'Someone'
      const smsBody = `${firstName} invited you to SeniorSafe! Join the family at app.seniorsafeapp.com/signup?code=${code} Reply STOP to opt out`

      const sent = await sendSMS(invitePhone.trim(), smsBody)
      if (!sent) throw new Error('SMS failed to send')

      setInviteSent(true)
    } catch (err) {
      setInviteError(err.message || 'Could not send invite')
    } finally {
      setInviteSending(false)
    }
  }

  async function handleFinish() {
    setSaving(true)
    const meta = user.user_metadata || {}
    const role = meta.role || 'admin'
    const family_code = role === 'member'
      ? null
      : (meta.family_code || await generateFamilyCode())

    const { error } = await supabase.from('user_profile').upsert({
      user_id: user.id,
      family_name: meta.family_name || '',
      first_name: meta.first_name || '',
      last_name: meta.last_name || '',
      phone: meta.phone || null,
      role,
      family_code,
      invited_by: meta.invited_by || null,
      checkin_alert_time: checkinTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      onboarding_complete: true,
    }, { onConflict: 'user_id' })

    setSaving(false)
    if (error) {
      alert('Error saving your profile: ' + error.message)
    } else {
      navigate('/dashboard')
    }
  }

  const progressPct = ((step + 1) / TOTAL) * 100

  // ─── Step 1: Set Check-In Time ────────────────────────────────────
  if (step === 0) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Header step={step} setStep={setStep} total={TOTAL} progressPct={progressPct} />

        <div className="flex-1 px-6 pt-8 pb-6 max-w-sm mx-auto w-full flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <Clock size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-xl leading-snug">
              When should your family expect to hear from you?
            </h1>
            <p className="text-gray-500 text-base leading-relaxed">
              If you haven&apos;t checked in by this time, we&apos;ll alert your family.
            </p>
          </div>

          <select
            value={checkinTime}
            onChange={e => setCheckinTime(e.target.value)}
            className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-medium text-lg bg-white appearance-none"
          >
            {TIME_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <p className="text-gray-400 text-sm text-center">
            You can change this anytime in Settings.
          </p>
        </div>

        <div className="px-6 pb-10 max-w-sm mx-auto w-full flex-shrink-0">
          <button
            onClick={handleSaveTime}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg"
          >
            Next
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 2: Invite a Family Member ───────────────────────────────
  if (step === 1) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Header step={step} setStep={setStep} total={TOTAL} progressPct={progressPct} />

        <div className="flex-1 px-6 pt-8 pb-6 max-w-sm mx-auto w-full flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <Users size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-xl leading-snug">
              Add a family member
            </h1>
            <p className="text-gray-500 text-base leading-relaxed">
              They&apos;ll get notified when you check in each day.
            </p>
          </div>

          {inviteSent ? (
            <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 flex flex-col items-center gap-3 text-center">
              <CheckCircle size={36} color="#16A34A" strokeWidth={1.5} />
              <p className="text-green-800 font-semibold">
                Invite sent to {inviteName}!
              </p>
              <p className="text-green-700 text-sm">
                They&apos;ll get a text with a link to join.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="First name"
                  className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-medium"
                  style={{ fontSize: '18px' }}
                />
                <input
                  type="tel"
                  inputMode="tel"
                  value={invitePhone}
                  onChange={e => setInvitePhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-medium"
                  style={{ fontSize: '18px' }}
                />
              </div>

              <button
                onClick={handleSendInvite}
                disabled={!inviteName.trim() || !invitePhone.trim() || inviteSending}
                className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg disabled:opacity-40"
              >
                {inviteSending ? 'Sending...' : 'Send Invite'}
              </button>

              {inviteError && (
                <p className="text-red-500 text-sm text-center">{inviteError}</p>
              )}
            </>
          )}
        </div>

        <div className="px-6 pb-10 max-w-sm mx-auto w-full flex-shrink-0 flex flex-col gap-3">
          {inviteSent ? (
            <button
              onClick={() => setStep(2)}
              className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => setStep(2)}
              className="w-full py-4 rounded-xl bg-gray-200 text-gray-600 font-semibold text-base"
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── Step 3: Add to Home Screen ───────────────────────────────────
  if (step === 2) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Header step={step} setStep={setStep} total={TOTAL} progressPct={progressPct} />

        <div className="flex-1 px-6 pt-8 pb-6 max-w-sm mx-auto w-full flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1B365D]/10 flex items-center justify-center">
              <Smartphone size={32} color="#1B365D" strokeWidth={1.5} />
            </div>
            <h1 className="text-[#1B365D] font-bold text-xl leading-snug">
              Add SeniorSafe to your home screen
            </h1>
            <p className="text-gray-500 text-base leading-relaxed">
              One tap to check in — just like a regular app.
            </p>
          </div>

          {platform === 'ios' && (
            <div className="bg-[#F5F5F5] rounded-2xl p-5 flex flex-col gap-4">
              <Step num="1" text='Tap the Share button at the bottom of Safari' icon="↑" />
              <Step num="2" text='Scroll down and tap "Add to Home Screen"' />
              <Step num="3" text='Tap "Add" in the top right' />
            </div>
          )}

          {platform === 'android' && (
            <div className="bg-[#F5F5F5] rounded-2xl p-5 flex flex-col gap-4">
              <Step num="1" text='Tap the three dots (⋮) in the top-right of Chrome' />
              <Step num="2" text='Tap "Add to Home screen"' />
              <Step num="3" text='Tap "Add"' />
            </div>
          )}

          {platform === 'desktop' && (
            <div className="bg-[#F5F5F5] rounded-2xl p-5 flex flex-col gap-4 text-center">
              <p className="text-[#1B365D] font-semibold text-base">
                Visit app.seniorsafeapp.com on your phone to add it to your home screen.
              </p>
              <p className="text-gray-500 text-sm leading-relaxed">
                SeniorSafe works best as a home screen shortcut on your phone — it&apos;s the easiest way to check in daily.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 pb-10 max-w-sm mx-auto w-full flex-shrink-0">
          <button
            onClick={handleFinish}
            disabled={saving}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Done — Go to Dashboard'}
          </button>
        </div>
      </div>
    )
  }

  return null
}

// ─── Shared Header ───────────────────────────────────────────────────
function Header({ step, setStep, total, progressPct }) {
  return (
    <div className="bg-[#1B365D] flex-shrink-0">
      <div className="px-6 pt-12 pb-4 max-w-sm mx-auto w-full flex items-center justify-between">
        <button
          onClick={() => step > 0 ? setStep(s => s - 1) : null}
          className={`p-2 -ml-2 rounded-lg ${step === 0 ? 'opacity-0 pointer-events-none' : 'text-white/70'}`}
        >
          <ChevronLeft size={24} />
        </button>
        <span className="text-[#D4A843] text-sm font-semibold">
          Step {step + 1} of {total}
        </span>
        <div className="w-8" />
      </div>
      <div className="w-full h-1 bg-white/20">
        <div
          className="h-full bg-[#D4A843] transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Step indicator for home screen instructions ─────────────────────
function Step({ num, text, icon }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-[#1B365D] flex items-center justify-center flex-shrink-0">
        <span className="text-white text-sm font-bold">{num}</span>
      </div>
      <p className="text-gray-700 text-base leading-snug pt-1">
        {icon && <span className="font-bold mr-1">{icon}</span>}
        {text}
      </p>
    </div>
  )
}
