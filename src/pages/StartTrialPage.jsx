import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Shield, CheckCircle, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isNative, isIOS } from '../lib/platform'
import { needsBilling, billingStarted, MONTHLY_PRICE, TRIAL_DAYS } from '../lib/subscription'
import { purchaseMonthly, restorePurchases, checkEntitlement, PREMIUM_PRODUCT_ID } from '../utils/purchases'
import { Shell, Heading, BigButton, TextLink, ErrorText } from '../components/SetupUI'

// The card step. Every new family owner lands here right after creating the
// account and before naming the person they look after.
//   Web: Stripe Checkout, 14 days free, card required, then $14.99 a month.
//   iPhone / Android: the store subscription with its 14-day free trial.
// Nothing is charged today. Members and seniors never see this screen.

const MARK_IAP_PAID_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/mark-iap-paid'

const POINTS = [
  'A text to the family every time your loved one checks in',
  'An alert to everyone if they have not checked in by their set time',
  'Maggie, the family assistant, for everyone',
  'Medications, appointments, documents, and family messages in one place',
]

export default function StartTrialPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(params.get('done') === '1')

  // Where to go once the card is on file.
  function next(p) {
    if (p?.onboarding_complete) navigate('/dashboard', { replace: true })
    else navigate(`/onboarding?path=${p?.is_senior ? 'self' : 'family'}`, { replace: true })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/signin', { replace: true }); return }
      const { data: p } = await supabase.from('user_profile').select('*').eq('user_id', user.id).single()
      if (cancelled) return
      if (!p) { navigate('/onboarding?path=oauth', { replace: true }); return }
      setProfile(p)
      if (!needsBilling(p)) { next(p); return }

      // Back from Stripe Checkout: the webhook lands a few seconds later.
      if (params.get('done') === '1') {
        for (let i = 0; i < 20 && !cancelled; i++) {
          await new Promise(r => setTimeout(r, 1500))
          const { data: fresh } = await supabase.from('user_profile').select('*').eq('user_id', user.id).single()
          if (fresh && billingStarted(fresh)) { next(fresh); return }
        }
        if (!cancelled) {
          setWaiting(false)
          setError('We have not heard back from the card step yet. Give it a minute and tap the button again. You will not be charged twice.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [navigate, params])

  async function startWeb() {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const { data, error: fnError } = await supabase.functions.invoke('create-checkout', {
        body: { plan: 'monthly', tier: 'premium', trial: true, return_to: 'start-trial' },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (fnError) throw new Error(fnError.message || 'Could not open the card step.')
      if (!data?.url) throw new Error('Could not open the card step.')
      window.location.href = data.url
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  async function markPaid(session, customerInfo) {
    const entitlement = customerInfo?.entitlements?.active?.['SeniorSafeApp Pro']
    const res = await fetch(MARK_IAP_PAID_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        productId: entitlement?.productIdentifier || PREMIUM_PRODUCT_ID,
        expiresDate: entitlement?.expirationDate || null,
        platform: isIOS() ? 'apple' : 'google',
      }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok || !result?.success) throw new Error(result?.error || 'Your trial started but we could not save it. Tap Restore purchases.')
  }

  async function startNative() {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const customerInfo = await purchaseMonthly()
      await markPaid(session, customerInfo)
      const { data: fresh } = await supabase.from('user_profile').select('*').eq('user_id', session.user.id).single()
      next(fresh || profile)
    } catch (err) {
      if (err?.code === 'PURCHASE_CANCELLED' || /cancel/i.test(err?.message || '')) { setLoading(false); return }
      setError(err.message || 'The store did not complete the purchase. Please try again.')
      setLoading(false)
    }
  }

  async function restore() {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const customerInfo = await restorePurchases()
      if (!(await checkEntitlement())) throw new Error('No subscription found for this Apple ID or Google account.')
      await markPaid(session, customerInfo)
      const { data: fresh } = await supabase.from('user_profile').select('*').eq('user_id', session.user.id).single()
      next(fresh || profile)
    } catch (err) {
      setError(err.message || 'Could not restore. Please try again.')
      setLoading(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/', { replace: true })
  }

  if (!profile || waiting) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Loader2 size={32} className="animate-spin text-[#1B365D]" />
        {waiting && <p className="text-[#6B645A]" style={{ fontSize: '17px' }}>Finishing up your free trial...</p>}
      </div>
    )
  }

  const native = isNative()
  const storeName = isIOS() ? 'the App Store' : 'Google Play'

  return (
    <Shell onBack={null}>
      <div className="flex items-center gap-3">
        <div className="bg-[#1B365D] rounded-2xl p-2.5">
          <Shield size={26} color="#D4A843" strokeWidth={1.5} />
        </div>
        <Heading title={`Start your ${TRIAL_DAYS} free days`} />
      </div>
      <p className="text-[#6B645A]" style={{ fontSize: '17px', lineHeight: 1.45 }}>
        Everything is on for {TRIAL_DAYS} days. After that it is {MONTHLY_PRICE} a month. Cancel anytime before then and you pay nothing.
      </p>
      <ul className="flex flex-col gap-2.5">
        {POINTS.map(t => (
          <li key={t} className="flex items-start gap-2.5 text-[#1B365D]" style={{ fontSize: '16px', lineHeight: 1.4 }}>
            <CheckCircle size={20} color="#2E7D4F" className="flex-shrink-0 mt-0.5" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <div className="bg-[#F6F3EC] rounded-2xl p-4 text-[#1B365D]" style={{ fontSize: '16px', lineHeight: 1.45 }}>
        <p className="font-semibold">Today: $0.00</p>
        <p>In {TRIAL_DAYS} days: {MONTHLY_PRICE} a month, billed {native ? `through ${storeName}` : 'to your card'}. We remind you 3 days before.</p>
      </div>
      <ErrorText>{error}</ErrorText>
      <BigButton large onClick={native ? startNative : startWeb} disabled={loading}>
        {loading ? 'One moment...' : native ? `Start free trial` : 'Add a card and start'}
      </BigButton>
      <p className="text-center text-gray-500" style={{ fontSize: '14px', lineHeight: 1.4 }}>
        {native
          ? `Billed through ${storeName}. Renews monthly unless cancelled at least 24 hours before the trial ends. Manage it in your ${isIOS() ? 'Apple ID' : 'Google Play'} subscriptions.`
          : 'Secure checkout by Stripe. Renews monthly until you cancel in Settings.'}
      </p>
      <div className="flex flex-col gap-3 pt-2 text-center text-gray-600" style={{ fontSize: '16px' }}>
        {native && <p><TextLink onClick={restore}>Already subscribed? Restore purchases</TextLink></p>}
        <p><TextLink onClick={signOut}>Not now, sign out</TextLink></p>
      </div>
    </Shell>
  )
}
