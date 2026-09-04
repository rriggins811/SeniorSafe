import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MessageSquare, Copy, Share2, CheckCircle, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateFamilyCode } from '../lib/familyCode'
import { copyToClipboard } from '../lib/platform'
import { dismissKeyboard } from '../lib/dismissKeyboard'
import {
  Shell, Heading, Field, BigButton, TextLink, ErrorText, Select,
} from '../components/SetupUI'
import { TIME_OPTIONS, formatTime12 } from '../lib/time'
import { baseProfileRow, PENDING_SIGNUP_KEY } from '../lib/signup'
import {
  seniorInviteLink, seniorInviteText, memberInviteLink, memberInviteText, smsHref,
} from '../lib/family'

// Two screens, for two kinds of owner:
//   family  the adult child: who do you look after, then invite them
//   self    the senior: pick a check-in time, then invite the family
// Members and seniors arriving by link never come here; SignUpPage finishes
// them and sends them to the dashboard.
//
// oauth: Google / Apple sign-ins land here with no profile row yet. We read
// what SignUpPage stashed before the redirect and either finish a join or
// show the owner screens, inserting the profile on the first submit so the
// is_senior flag is set once and correctly.

function deriveName(meta) {
  if (meta.first_name || meta.last_name) return { firstName: meta.first_name || '', lastName: meta.last_name || '' }
  const full = (meta.full_name || meta.name || '').trim()
  if (full) {
    const parts = full.split(/\s+/)
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }
  }
  return { firstName: '', lastName: '' }
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requested = params.get('path') || 'family'

  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)      // existing row, or null for oauth
  const [path, setPath] = useState(requested === 'oauth' ? 'family' : requested)
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [handoff, setHandoff] = useState(false)

  // Owner details (oauth users type their own name here; email users already did)
  const [ownerFirst, setOwnerFirst] = useState('')
  const [ownerLast, setOwnerLast] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  // The person being looked after
  const [seniorFirst, setSeniorFirst] = useState('')
  const [seniorPhone, setSeniorPhone] = useState('')
  const [alertTime, setAlertTime] = useState('09:00')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) { navigate('/signin', { replace: true }); return }
      if (cancelled) return
      setUser(u)
      const meta = u.user_metadata || {}
      const derived = deriveName(meta)
      setOwnerFirst(derived.firstName)
      setOwnerLast(derived.lastName)
      setOwnerPhone(meta.phone || '')

      const { data: p } = await supabase.from('user_profile').select('*').eq('user_id', u.id).single()
      if (cancelled) return

      if (p?.onboarding_complete) { navigate('/dashboard', { replace: true }); return }

      if (p) {
        // Existing row: a member who never finished the old flow, or an owner
        // mid-setup. Members have nothing to set up.
        if (p.role === 'member') {
          await supabase.from('user_profile').update({ onboarding_complete: true }).eq('user_id', u.id)
          navigate('/dashboard', { replace: true })
          return
        }
        setProfile(p)
        setPath(p.is_senior ? 'self' : 'family')
        setOwnerFirst(p.first_name || derived.firstName)
        setOwnerLast(p.last_name || derived.lastName)
        setOwnerPhone(p.phone || '')
        if (p.senior_name && !p.is_senior) setSeniorFirst(p.senior_name)
        if (p.senior_phone) setSeniorPhone(p.senior_phone)
        if (p.checkin_alert_time && p.checkin_alert_time !== '12:00') setAlertTime(p.checkin_alert_time)
        setReady(true)
        return
      }

      // No row: an OAuth sign-in. What were they doing before the redirect?
      let pending = null
      try {
        const raw = localStorage.getItem(PENDING_SIGNUP_KEY)
        if (raw) pending = JSON.parse(raw)
        localStorage.removeItem(PENDING_SIGNUP_KEY)
      } catch { /* ignore */ }

      if (pending?.code && (pending.mode === 'join' || pending.mode === 'senior')) {
        const { data: rows } = await supabase.rpc('lookup_invite_code', { invite_code: pending.code })
        const inv = rows?.[0]
        if (inv) {
          const asSenior = pending.mode === 'senior' && !inv.has_senior
          const first = derived.firstName || (asSenior ? inv.senior_name : '') || 'Family'
          const { error: pErr } = await supabase.from('user_profile').upsert({
            ...baseProfileRow(u.id),
            first_name: first, last_name: derived.lastName, family_name: inv.family_name,
            phone: meta.phone || null,
            role: 'member', invited_by: inv.user_id, family_code: null,
            is_senior: asSenior, senior_name: asSenior ? first : null,
            onboarding_complete: true,
          }, { onConflict: 'user_id' })
          if (!pErr) { navigate('/dashboard', { replace: true }); return }
          setError('Joining the family failed: ' + pErr.message)
        }
      }
      setPath(pending?.mode === 'self' ? 'self' : 'family')
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [navigate])

  const isOauthNew = ready && !profile
  const familyCode = profile?.family_code || ''
  const [oauthCode, setOauthCode] = useState('')
  const codeForLinks = familyCode || oauthCode

  // ─── Persist step 1 ────────────────────────────────────────────────
  async function saveOwnerSetup() {
    dismissKeyboard()
    if (path === 'family' && !seniorFirst.trim()) { setError("Please enter their first name."); return }
    if (isOauthNew && !ownerFirst.trim()) { setError('Please enter your first name.'); return }
    setSaving(true)
    setError('')

    const first = ownerFirst.trim()
    const last = ownerLast.trim()
    const isSelf = path === 'self'
    const senior = seniorFirst.trim()
    const sPhone = seniorPhone.trim() || null

    if (isOauthNew) {
      const code = await generateFamilyCode()
      const familyName = last ? `The ${last} Family` : `${first || senior || 'Your'}'s Family`
      const { error: pErr } = await supabase.from('user_profile').upsert({
        ...baseProfileRow(user.id),
        first_name: first, last_name: last, family_name: familyName,
        phone: ownerPhone.trim() || null,
        role: 'admin', family_code: code,
        is_senior: isSelf,
        senior_name: isSelf ? first : senior,
        senior_phone: isSelf ? null : sPhone,
        checkin_alert_time: alertTime,
        onboarding_complete: false,
      }, { onConflict: 'user_id' })
      if (pErr) { setError('Saving failed: ' + pErr.message); setSaving(false); return }
      setOauthCode(code)
      setProfile({ user_id: user.id, first_name: first, family_code: code, is_senior: isSelf })
    } else {
      const { error: uErr } = await supabase.from('user_profile').update({
        senior_name: isSelf ? first : senior,
        senior_phone: isSelf ? null : sPhone,
        checkin_alert_time: alertTime,
        ...(ownerPhone.trim() ? { phone: ownerPhone.trim() } : {}),
      }).eq('user_id', user.id)
      if (uErr) { setError('Saving failed: ' + uErr.message); setSaving(false); return }
    }
    setSaving(false)
    setStep(1)
  }

  async function finish() {
    setSaving(true)
    const { error: uErr } = await supabase.from('user_profile')
      .update({ onboarding_complete: true })
      .eq('user_id', user.id)
    setSaving(false)
    if (uErr) { setError('Saving failed: ' + uErr.message); return }
    navigate('/dashboard', { replace: true })
  }

  // "I'm holding their phone": finish the owner's setup, sign out of this
  // device, and open the senior's link right here.
  async function handOffThisPhone() {
    setSaving(true)
    await supabase.from('user_profile').update({ onboarding_complete: true }).eq('user_id', user.id)
    await supabase.auth.signOut()
    setSaving(false)
    navigate(`/signup?code=${codeForLinks}&who=senior`, { replace: true })
  }

  async function copy(text, key) {
    await copyToClipboard(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2500)
  }

  async function share(text) {
    if (navigator.share) {
      try { await navigator.share({ title: 'SeniorSafe', text }) } catch { /* cancelled */ }
    } else {
      await copy(text, 'share')
    }
  }

  if (!ready) return null

  const timeLabel = formatTime12(alertTime)

  // ═════════════════════════════════════════════════════════════════════
  //  FAMILY path: the adult child
  // ═════════════════════════════════════════════════════════════════════
  if (path === 'family') {
    if (step === 0) {
      return (
        <Shell step={1} total={2}>
          <Heading title="Who do you look after?" sub="One person for now. They'll be the one tapping the button each morning." />
          <div className="flex flex-col gap-4">
            {isOauthNew && (
              <>
                <Field label="Your first name" value={ownerFirst} onChange={setOwnerFirst} autoFocus />
                <Field label="Your mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="(336) 555-0100" hint="The daily check-in comes to you as a text." value={ownerPhone} onChange={setOwnerPhone} />
              </>
            )}
            <Field label="Their first name" placeholder="e.g. Mom, Margaret" value={seniorFirst} onChange={v => { setSeniorFirst(v); setError('') }} autoFocus={!isOauthNew} />
            <Field label="Their mobile number" type="tel" inputMode="tel" placeholder="(336) 555-0100" hint="We'll text them a link that opens straight to their button. You can add this later." value={seniorPhone} onChange={setSeniorPhone} />
            <Select
              label="Check-in time"
              value={alertTime}
              onChange={setAlertTime}
              options={TIME_OPTIONS}
              hint={`If ${seniorFirst.trim() || 'they'} ${seniorFirst.trim() ? "hasn't" : "haven't"} tapped "I'm Okay" by ${timeLabel}, you get an alert.`}
            />
          </div>
          <ErrorText>{error}</ErrorText>
          <BigButton onClick={saveOwnerSetup} disabled={saving}>{saving ? 'Saving...' : 'Continue'}</BigButton>
          {isOauthNew && (
            <p className="text-center text-gray-600">
              Setting this up for yourself? <TextLink onClick={() => { setPath('self'); setError('') }}>Start here</TextLink>
            </p>
          )}
        </Shell>
      )
    }

    const name = seniorFirst.trim() || 'them'
    const text = seniorInviteText({ seniorName: seniorFirst.trim(), ownerFirstName: ownerFirst.trim(), code: codeForLinks })
    const link = seniorInviteLink(codeForLinks)
    const hasPhone = seniorPhone.replace(/\D/g, '').length >= 10

    return (
      <Shell step={2} total={2} onBack={() => setStep(0)}>
        <Heading title={`Invite ${name}`} sub={`${name} needs SeniorSafe on their phone. The link opens straight to their button with their name on it.`} />
        <div className="flex flex-col gap-3">
          {hasPhone ? (
            <BigButton href={smsHref(seniorPhone, text)}>
              <MessageSquare size={22} /> Text {name} the link
            </BigButton>
          ) : (
            <BigButton onClick={() => share(text)}>
              <Share2 size={22} /> Share the link
            </BigButton>
          )}
          <BigButton secondary onClick={() => copy(link, 'link')}>
            {copied === 'link' ? <><CheckCircle size={22} /> Copied</> : <><Copy size={22} /> Copy the link</>}
          </BigButton>
        </div>

        <div className="bg-[#FAF8F4] border border-[#E7E2D8] rounded-2xl p-4 flex flex-col gap-2">
          <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>What happens next</p>
          <p className="text-[#2D2A24]" style={{ fontSize: '16px', lineHeight: 1.5 }}>
            {name} opens the link, picks an email and password, and sees their "I'm Okay" button. You get a text every time they tap it, and an alert if they haven't by {timeLabel}. Your dashboard shows "waiting for {name}" until then.
          </p>
        </div>

        <BigButton onClick={finish} disabled={saving}>{saving ? 'One moment...' : 'Done, take me to the app'}</BigButton>

        <div className="text-center">
          <TextLink onClick={() => setHandoff(true)}>I'm holding {name}'s phone right now</TextLink>
        </div>
        <ErrorText>{error}</ErrorText>

        {handoff && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-xl">
              <div className="flex items-center gap-3">
                <Smartphone size={26} color="#1B365D" />
                <h2 className="text-[#1B365D] font-bold text-xl">Set up {name}'s phone now</h2>
              </div>
              <p className="text-[#2D2A24]" style={{ fontSize: '16px', lineHeight: 1.5 }}>
                We'll sign you out of this phone and open {name}'s setup here. Later, sign in on your own phone with your email to see their check-ins.
              </p>
              <BigButton onClick={handOffThisPhone} disabled={saving}>{saving ? 'One moment...' : `Continue on this phone`}</BigButton>
              <button onClick={() => setHandoff(false)} className="text-gray-500 font-medium py-2">Cancel</button>
            </div>
          </div>
        )}
      </Shell>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  SELF path: the senior setting up for themselves
  // ═════════════════════════════════════════════════════════════════════
  if (step === 0) {
    return (
      <Shell step={1} total={2}>
        <Heading large title="Your daily check-in" sub={`Each morning you'll tap one button to let your family know you're okay. Pick the time they should hear from you by.`} />
        <div className="flex flex-col gap-4">
          {isOauthNew && (
            <>
              <Field large label="Your first name" value={ownerFirst} onChange={setOwnerFirst} autoFocus />
              <Field large label="Your mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="(336) 555-0100" hint="Optional. Lets your family send you a text nudge." value={ownerPhone} onChange={setOwnerPhone} />
            </>
          )}
          <Select large label="Check in by" value={alertTime} onChange={setAlertTime} options={TIME_OPTIONS} hint={`If you haven't tapped "I'm Okay" by ${timeLabel}, your family gets an alert.`} />
        </div>
        <ErrorText>{error}</ErrorText>
        <BigButton large onClick={saveOwnerSetup} disabled={saving}>{saving ? 'Saving...' : 'Continue'}</BigButton>
        {isOauthNew && (
          <p className="text-center text-gray-600">
            Setting this up for someone else? <TextLink onClick={() => { setPath('family'); setError('') }}>Start here</TextLink>
          </p>
        )}
      </Shell>
    )
  }

  const mText = memberInviteText({ seniorName: ownerFirst.trim(), code: codeForLinks })
  return (
    <Shell step={2} total={2} onBack={() => setStep(0)}>
      <Heading large title="Invite your family" sub="Send this to the people who should hear from you each morning. You can add more later." />
      <div className="bg-[#FAF8F4] rounded-2xl p-6 flex flex-col items-center gap-2">
        <p className="text-sm text-gray-500 font-medium uppercase tracking-wider">Your family code</p>
        <p className="text-[#1B365D] font-bold tracking-[0.25em]" style={{ fontSize: '40px' }}>{codeForLinks}</p>
      </div>
      <div className="flex flex-col gap-3">
        <BigButton large onClick={() => share(mText)}><Share2 size={22} /> Share the link</BigButton>
        <BigButton large secondary onClick={() => copy(memberInviteLink(codeForLinks), 'link')}>
          {copied === 'link' ? <><CheckCircle size={22} /> Copied</> : <><Copy size={22} /> Copy the link</>}
        </BigButton>
      </div>
      <ErrorText>{error}</ErrorText>
      <BigButton large onClick={finish} disabled={saving}>{saving ? 'One moment...' : 'Done'}</BigButton>
      <div className="text-center"><TextLink onClick={finish}>I'll invite them later</TextLink></div>
    </Shell>
  )
}
