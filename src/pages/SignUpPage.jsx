import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Shield, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateFamilyCode } from '../lib/familyCode'
import { isNative } from '../lib/platform'
import { Browser } from '@capacitor/browser'
import { dismissKeyboard } from '../lib/dismissKeyboard'
import { baseProfileRow, PENDING_SIGNUP_KEY } from '../lib/signup'
import {
  Shell, Heading, Field, BigButton, TextLink, ErrorText, Disclosure, OAuthButtons, Divider, Select,
} from '../components/SetupUI'

const NATIVE_REDIRECT = 'com.rigginsstrategicsolutions.seniorsafe://auth/callback'

function getOAuthRedirect() {
  return isNative() ? NATIVE_REDIRECT : window.location.origin + '/dashboard'
}

const RELATIONSHIPS = [
  { value: '', label: 'Choose one' },
  { value: 'Daughter', label: 'Daughter' },
  { value: 'Son', label: 'Son' },
  { value: 'Spouse', label: 'Spouse' },
  { value: 'Grandchild', label: 'Grandchild' },
  { value: 'Sibling', label: 'Sibling' },
  { value: 'Caregiver', label: 'Caregiver' },
  { value: 'Friend', label: 'Friend or neighbor' },
  { value: 'Other', label: 'Other' },
]

// Modes:
//   family  (default) an adult child setting up for someone they look after
//   self    a senior setting up for themselves
//   join    someone with an invite code joining as a family member
//   senior  the senior opening the link the adult child sent them
export default function SignUpPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const urlCode = (params.get('code') || '').toUpperCase()
  const urlWho = params.get('who')

  const [mode, setMode] = useState(urlCode ? 'join' : 'family')
  const [invite, setInvite] = useState(null)      // result of lookup_invite_code
  const [code, setCode] = useState(urlCode)
  const [checking, setChecking] = useState(!!urlCode)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState('')
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '', password: '', relationship: '',
  })
  const update = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError('') }

  // A link with a code: look it up once and pick the right screen.
  useEffect(() => {
    if (!urlCode) return
    ;(async () => {
      const { data: rows, error: err } = await supabase.rpc('lookup_invite_code', { invite_code: urlCode })
      const row = rows?.[0]
      setChecking(false)
      if (err || !row) {
        setMode('join')
        setInvite(null)
        setError(err?.message?.includes('Too many') ? err.message : 'That invite link is no longer valid. Ask your family for a new one.')
        return
      }
      setInvite(row)
      if (urlWho === 'senior' && !row.has_senior) {
        setMode('senior')
        setForm(f => ({ ...f, firstName: row.senior_name || '' }))
      } else {
        setMode('join')
      }
    })()
  }, [urlCode, urlWho])

  async function lookupCode() {
    dismissKeyboard()
    const c = code.trim().toUpperCase()
    if (c.length < 4) { setError('The code is 6 letters and numbers.'); return }
    setLoading(true)
    const { data: rows, error: err } = await supabase.rpc('lookup_invite_code', { invite_code: c })
    setLoading(false)
    const row = rows?.[0]
    if (err || !row) {
      setError(err?.message?.includes('Too many') ? err.message : 'We could not find that code. Check it with your family and try again.')
      return
    }
    setCode(c)
    setInvite(row)
    setError('')
  }

  // ─── OAuth ─────────────────────────────────────────────────────────
  // The provider redirect loses page state, so remember what the person was
  // doing. OnboardingPage reads this back and finishes the right profile.
  async function startOAuth(provider) {
    setOauthLoading(provider)
    setError('')
    try {
      localStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({
        mode,
        code: invite ? code : null,
        savedAt: Date.now(),
      }))
      if (isNative()) {
        const { data, error: err } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
        })
        if (err) throw err
        if (data?.url) await Browser.open({ url: data.url })
      } else {
        const { error: err } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: getOAuthRedirect() },
        })
        if (err) throw err
      }
    } catch (err) {
      setError(err.message || 'That sign-in did not work. Please try again.')
      setOauthLoading('')
    }
  }

  // ─── Email signups ─────────────────────────────────────────────────
  function validateBasics({ needPhone }) {
    if (!form.firstName.trim()) return 'Please enter a first name.'
    if (needPhone && form.phone.replace(/\D/g, '').length < 10) return 'Please enter a mobile number so the check-in text reaches you.'
    if (!form.email.trim()) return 'Please enter an email address.'
    if (form.password.length < 6) return 'Choose a password of at least 6 characters.'
    return ''
  }

  function friendlyAuthError(err) {
    const m = err?.message || ''
    if (/already registered|already exists/i.test(m)) return 'There is already an account with that email. Sign in instead.'
    if (/valid email/i.test(m)) return 'That email address does not look right.'
    return m || 'Something went wrong. Please try again.'
  }

  // Owner: adult child (family) or the senior themself (self).
  async function createOwner(isSelf) {
    dismissKeyboard()
    const v = validateBasics({ needPhone: !isSelf })
    if (v) { setError(v); return }
    setLoading(true)
    setError('')

    const familyCode = await generateFamilyCode()
    const first = form.firstName.trim()
    const last = form.lastName.trim()
    const familyName = last ? `The ${last} Family` : `${first}'s Family`
    const phone = form.phone.trim() || null

    const { data, error: err } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          first_name: first, last_name: last, family_name: familyName, phone,
          role: 'admin', family_code: familyCode, is_senior: isSelf,
          onboarding_path: isSelf ? 'self' : 'family',
        },
      },
    })
    if (err) { setError(friendlyAuthError(err)); setLoading(false); return }
    if (!data?.user) { setError('We could not create the account. Please try again.'); setLoading(false); return }

    const { error: pErr } = await supabase.from('user_profile').upsert({
      ...baseProfileRow(data.user.id),
      first_name: first, last_name: last, family_name: familyName, phone,
      role: 'admin', family_code: familyCode,
      is_senior: isSelf,
      senior_name: isSelf ? first : null,
      onboarding_complete: false,
    }, { onConflict: 'user_id' })
    setLoading(false)
    if (pErr) { setError('Account created, but saving your details failed: ' + pErr.message); return }
    navigate(`/onboarding?path=${isSelf ? 'self' : 'family'}`)
  }

  // Member (sibling, caregiver) or the senior joining by link.
  async function createMember(asSenior) {
    dismissKeyboard()
    if (!invite) return
    const v = validateBasics({ needPhone: !asSenior })
    if (v) { setError(v); return }
    setLoading(true)
    setError('')

    const first = form.firstName.trim()
    const last = form.lastName.trim()
    const phone = form.phone.trim() || null

    const { data, error: err } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          first_name: first, last_name: last, family_name: invite.family_name, phone,
          role: 'member', invited_by: invite.user_id, is_senior: asSenior,
          relationship: form.relationship || null,
          onboarding_path: asSenior ? 'senior' : 'join',
        },
      },
    })
    if (err) { setError(friendlyAuthError(err)); setLoading(false); return }
    if (!data?.user) { setError('We could not create the account. Please try again.'); setLoading(false); return }

    const { error: pErr } = await supabase.from('user_profile').upsert({
      ...baseProfileRow(data.user.id),
      first_name: first, last_name: last, family_name: invite.family_name, phone,
      role: 'member', invited_by: invite.user_id, family_code: null,
      is_senior: asSenior,
      senior_name: asSenior ? first : null,
      onboarding_complete: true,
    }, { onConflict: 'user_id' })
    setLoading(false)
    if (pErr) {
      setError(pErr.message?.includes('one_senior_per_family')
        ? `${invite.senior_name || 'Someone'} has already joined this family as the person who checks in. Ask ${invite.owner_first_name || 'your family'} to send a family-member link instead.`
        : 'Account created, but joining the family failed: ' + pErr.message)
      return
    }
    navigate('/dashboard', { replace: true })
  }

  // ═════════════════════════════════════════════════════════════════════
  if (checking) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <Loader2 size={32} className="animate-spin text-[#1B365D]" />
        <p className="text-gray-500 text-lg">Opening your invite...</p>
      </div>
    )
  }

  const seniorName = invite?.senior_name || ''
  const ownerFirst = invite?.owner_first_name || ''

  // ─── The senior, arriving by link ──────────────────────────────────
  if (mode === 'senior' && invite) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-[#1B365D] rounded-2xl p-3">
            <Shield size={32} color="#D4A843" strokeWidth={1.5} />
          </div>
        </div>
        <Heading
          large
          title={seniorName ? `Hi ${seniorName}.` : 'Hello.'}
          sub={`${ownerFirst || 'Your family'} set up SeniorSafe so you can let them know you're okay each morning with one tap.`}
        />
        <p className="text-[#2D2A24]" style={{ fontSize: '18px', lineHeight: 1.5 }}>
          To finish, choose an email and a password for your account. {ownerFirst || 'Your family'} can help with this part.
        </p>
        <div className="flex flex-col gap-5">
          <Field large label="Your first name" value={form.firstName} onChange={v => update('firstName', v)} />
          <Field large label="Your email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={v => update('email', v)} />
          <Field large label="Choose a password" type="password" autoComplete="new-password" hint="At least 6 characters. Tap the eye to see it." value={form.password} onChange={v => update('password', v)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <BigButton large onClick={() => createMember(true)} disabled={loading}>
          {loading ? 'One moment...' : 'Continue'}
        </BigButton>
        <Divider>or</Divider>
        <OAuthButtons onGoogle={() => startOAuth('google')} onApple={() => startOAuth('apple')} googleLoading={oauthLoading === 'google'} appleLoading={oauthLoading === 'apple'} />
        <Disclosure />
      </Shell>
    )
  }

  // ─── Joining with a code ───────────────────────────────────────────
  if (mode === 'join') {
    if (!invite) {
      return (
        <Shell onBack={() => { setMode('family'); setError('') }}>
          <Heading title="Enter your invite code" sub="Ask the person who set up SeniorSafe for their 6-character family code." />
          <input
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setError('') }}
            placeholder="A3BX7K"
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect="off"
            className="w-full px-6 py-5 border-2 border-gray-200 rounded-2xl text-center text-3xl font-bold tracking-[0.3em] text-[#1B365D] focus:outline-none focus:border-[#1B365D] uppercase"
            autoFocus
          />
          <ErrorText>{error}</ErrorText>
          <BigButton onClick={lookupCode} disabled={loading || code.trim().length < 4}>
            {loading ? 'Checking...' : 'Continue'}
          </BigButton>
          <p className="text-center text-gray-500">
            Already have an account? <TextLink to="/signin">Sign in</TextLink>
          </p>
        </Shell>
      )
    }
    return (
      <Shell onBack={() => { if (urlCode) navigate('/signup'); else setInvite(null) }}>
        <Heading
          title={seniorName ? `Join ${seniorName}'s family` : `Join ${invite.family_name || 'the family'}`}
          sub={`You'll get the daily "I'm okay" check-in${seniorName ? ` from ${seniorName}` : ''}, and you can send a nudge if it's late.`}
        />
        <div className="flex flex-col gap-4">
          <Field label="Your first name" value={form.firstName} onChange={v => update('firstName', v)} autoFocus />
          <Field label="Last name" value={form.lastName} onChange={v => update('lastName', v)} />
          <Field label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="(336) 555-0100" hint="The check-in comes to you as a text." value={form.phone} onChange={v => update('phone', v)} />
          <Select label={seniorName ? `You are ${seniorName}'s` : 'Your relationship'} value={form.relationship} onChange={v => update('relationship', v)} options={RELATIONSHIPS} />
          <Field label="Email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={v => update('email', v)} />
          <Field label="Password" type="password" autoComplete="new-password" hint="At least 6 characters." value={form.password} onChange={v => update('password', v)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <BigButton onClick={() => createMember(false)} disabled={loading}>
          {loading ? 'Joining...' : 'Join the family'}
        </BigButton>
        <Divider>or</Divider>
        <OAuthButtons onGoogle={() => startOAuth('google')} onApple={() => startOAuth('apple')} googleLoading={oauthLoading === 'google'} appleLoading={oauthLoading === 'apple'} />
        <Disclosure />
      </Shell>
    )
  }

  // ─── Setting up for yourself ───────────────────────────────────────
  if (mode === 'self') {
    return (
      <Shell onBack={() => { setMode('family'); setError('') }}>
        <Heading title="Set up SeniorSafe for yourself" sub="You'll pick your check-in time and invite your family on the next screens." />
        <div className="flex flex-col gap-4">
          <Field large label="Your first name" value={form.firstName} onChange={v => update('firstName', v)} autoFocus />
          <Field large label="Last name" value={form.lastName} onChange={v => update('lastName', v)} />
          <Field large label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="(336) 555-0100" hint="Optional. Lets your family send you a text nudge." value={form.phone} onChange={v => update('phone', v)} />
          <Field large label="Email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={v => update('email', v)} />
          <Field large label="Choose a password" type="password" autoComplete="new-password" hint="At least 6 characters. Tap the eye to see it." value={form.password} onChange={v => update('password', v)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <BigButton large onClick={() => createOwner(true)} disabled={loading}>
          {loading ? 'One moment...' : 'Create my account'}
        </BigButton>
        <Divider>or</Divider>
        <OAuthButtons onGoogle={() => startOAuth('google')} onApple={() => startOAuth('apple')} googleLoading={oauthLoading === 'google'} appleLoading={oauthLoading === 'apple'} />
        <Disclosure />
      </Shell>
    )
  }

  // ─── Default: an adult child setting up for someone ────────────────
  return (
    <Shell onBack={() => navigate('/')}>
      <div className="flex items-center gap-3">
        <div className="bg-[#1B365D] rounded-2xl p-2.5">
          <Shield size={26} color="#D4A843" strokeWidth={1.5} />
        </div>
        <Heading title="Set up SeniorSafe" />
      </div>
      <p className="text-[#6B645A]" style={{ fontSize: '17px', lineHeight: 1.45 }}>
        About two minutes. You'll add the person you look after on the next screen, and they get a link that opens straight to their button.
      </p>
      <OAuthButtons onGoogle={() => startOAuth('google')} onApple={() => startOAuth('apple')} googleLoading={oauthLoading === 'google'} appleLoading={oauthLoading === 'apple'} />
      <Divider>or with email</Divider>
      <div className="flex flex-col gap-4">
        <Field label="Your first name" value={form.firstName} onChange={v => update('firstName', v)} />
        <Field label="Last name" value={form.lastName} onChange={v => update('lastName', v)} />
        <Field label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="(336) 555-0100" hint="The daily check-in comes to you as a text." value={form.phone} onChange={v => update('phone', v)} />
        <Field label="Email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={v => update('email', v)} />
        <Field label="Password" type="password" autoComplete="new-password" hint="At least 6 characters." value={form.password} onChange={v => update('password', v)} />
      </div>
      <ErrorText>{error}</ErrorText>
      <BigButton onClick={() => createOwner(false)} disabled={loading}>
        {loading ? 'Creating your account...' : 'Create my account'}
      </BigButton>
      <Disclosure />
      <div className="flex flex-col gap-3 pt-2 text-center text-gray-600" style={{ fontSize: '16px' }}>
        <p>Have an invite code? <TextLink onClick={() => { setMode('join'); setError('') }}>Join your family</TextLink></p>
        <p>Setting this up for yourself? <TextLink onClick={() => { setMode('self'); setError('') }}>Start here</TextLink></p>
        <p>Already have an account? <Link to="/signin" className="text-[#1B365D] font-semibold underline underline-offset-2">Sign in</Link></p>
      </div>
    </Shell>
  )
}
