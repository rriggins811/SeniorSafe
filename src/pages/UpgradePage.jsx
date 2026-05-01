import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Shield, CheckCircle, X, Sparkles, ArrowLeft,
  Heart, Pill, FolderLock, Bot, Users, Bell, Clock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isIOS, isAndroid } from '../lib/platform'
import {
  purchaseMonthly as rcPurchaseMonthly,
  purchasePremiumPlus as rcPurchasePremiumPlus,
  restorePurchases as rcRestorePurchases,
  isNativePlatform,
  checkEntitlement,
  checkPremiumPlusEntitlement,
  PREMIUM_PRODUCT_ID,
  PREMIUM_PLUS_PRODUCT_ID,
} from '../utils/purchases'

const MARK_IAP_PAID_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/mark-iap-paid'

const FREE_FEATURES = [
  { icon: Heart,  text: 'Daily "I\'m Okay" check-in' },
  { icon: Bell,   text: '"I Need Help" emergency SMS alerts' },
  { icon: Users,  text: '1 invited family member (unlimited on Premium)' },
  { icon: Bot,    text: '10 AI messages per month' },
  { icon: Shield, text: 'Emergency Info card' },
]

const PAID_FEATURES = [
  { icon: Heart,      text: 'Everything in Free, plus:' },
  { icon: Heart,      text: 'Family gets a text every time your loved one checks in — no app required' },
  { icon: Bell,       text: 'If your loved one hasn\'t checked in by their set time, every family member gets an automatic text alert' },
  { icon: Users,      text: 'Send a gentle reminder text to your loved one directly from the app — with a built-in daily limit so it never feels like nagging' },
  { icon: Clock,      text: 'See a full month of daily check-ins at a glance — know the pattern, spot the gaps' },
  { icon: Users,      text: 'Add every sibling, every caregiver — everyone stays in the loop automatically' },
  { icon: Bot,        text: 'Ask anything, anytime — senior transitions, caregiving, legal prep, or just a friendly conversation' },
  { icon: FolderLock, text: 'Store wills, insurance policies, and medical records securely — accessible to family the moment they\'re needed' },
  { icon: Pill,       text: 'Automated SMS reminders so your loved one never misses a dose' },
]

// Build 27: Premium+ tier features.
const PAID_PLUS_FEATURES = [
  { icon: Sparkles, text: 'Everything in Premium, plus:' },
  { icon: Bot,      text: 'Maggie — a tactical AI specialist for adult children navigating a parent\'s senior transition (housing, Medicare, exploitation prevention, Blueprint planning)' },
  { icon: Heart,    text: 'Persistent family memory — Maggie remembers your family\'s situation across every conversation, so you never have to re-explain' },
  { icon: FolderLock, text: 'Blueprint planning tools, surfaced when relevant to your conversation' },
]

export default function UpgradePage() {
  const navigate = useNavigate()
  const [plan, setPlan] = useState('monthly') // 'monthly' or 'annual'
  const [loading, setLoading] = useState(false)
  const [tier, setTier] = useState(null)
  const [error, setError] = useState('')
  const [isMember, setIsMember] = useState(false)
  const [adminUserId, setAdminUserId] = useState(null)
  const [adminSeniorName, setAdminSeniorName] = useState('')
  const [iapLoading, setIapLoading] = useState(false)
  const [iapPlusLoading, setIapPlusLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const onNativeStore = isNativePlatform()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { navigate('/signin'); return }
      supabase.from('user_profile').select('subscription_tier, role, invited_by').eq('user_id', user.id).single()
        .then(async ({ data }) => {
          // Role guard: only admins can manage billing
          if (data && data.role !== 'admin') {
            // Look up admin's first_name (root of invited_by chain)
            let adminFirstName = ''
            if (data.invited_by) {
              const { data: adminProfile } = await supabase
                .from('user_profile')
                .select('first_name')
                .eq('user_id', data.invited_by)
                .single()
              adminFirstName = adminProfile?.first_name || ''
            }
            const who = adminFirstName ? `your family admin (${adminFirstName})` : 'your family admin'
            navigate('/dashboard', {
              replace: true,
              state: { upgradeMessage: `Your family admin manages billing. Reach out to ${who} to upgrade your family.` },
            })
            return
          }

          setTier(data?.subscription_tier || 'free')
        })
    })
  }, [navigate])

  async function handleCheckout() {
    setLoading(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      console.log('DEBUG session:', session?.access_token ? 'JWT present' : 'JWT MISSING')
      console.log('DEBUG user:', session?.user?.email)

      if (!session) throw new Error('Not logged in')

      const { data, error: fnError } = await supabase.functions.invoke('create-checkout', {
        body: { plan, ...(isMember && adminUserId ? { admin_user_id: adminUserId } : {}) },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (fnError) {
        const code = fnError.context?.status || fnError.status || 'fn-error'
        const detail = fnError.message || 'Unable to start checkout.'
        throw new Error(`${detail} (${code}). If this keeps happening, text Ryan at (336) 553-8933 or email support@seniorsafeapp.com.`)
      }

      if (!data?.url) {
        throw new Error('Checkout URL missing from response. If this keeps happening, text Ryan at (336) 553-8933 or email support@seniorsafeapp.com.')
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  async function handleIAPPurchase() {
    setIapLoading(true)
    setError('')
    try {
      const customerInfo = await rcPurchaseMonthly()

      // Purchase succeeded — call edge function to upgrade in Supabase
      // (Direct Supabase update is blocked by protect_user_profile_columns trigger)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not logged in')

      // Pull metadata from RevenueCat customerInfo if available
      const entitlement = customerInfo?.entitlements?.active?.['SeniorSafeApp Pro']
      const body = {
        originalTransactionId: entitlement?.originalPurchaseDate ? String(entitlement?.productIdentifier || '') : null,
        productId: entitlement?.productIdentifier || 'com.rigginsstrategicsolutions.seniorsafe.monthly',
        expiresDate: entitlement?.expirationDate || null,
        adminUserId: isMember && adminUserId ? adminUserId : null,
        platform: isIOS() ? 'apple' : 'google',
      }

      const res = await fetch(MARK_IAP_PAID_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(body),
      })

      const result = await res.json()
      if (!res.ok || !result?.success) {
        throw new Error(`Purchase succeeded but account update failed: ${result?.error || res.statusText}`)
      }

      setTier('paid')
    } catch (err) {
      // User cancelled — do nothing
      if (err?.code === 'PURCHASE_CANCELLED' || err?.message?.toLowerCase().includes('cancel')) {
        setIapLoading(false)
        return
      }
      setError(err.message || 'Purchase failed. Please try again.')
    } finally {
      setIapLoading(false)
    }
  }

  // Build 27: Premium+ purchase. Mirrors handleIAPPurchase but buys the
  // premium_plus_monthly RevenueCat package and forwards the Premium+
  // productId to mark-iap-paid so the edge function sets tier='premium_plus'
  // (not 'paid'). Apple StoreKit handles Premium → Premium+ upgrade
  // proration automatically because both products are in the same Apple
  // subscription group (ID 22003343); we just call purchasePackage().
  async function handlePremiumPlusPurchase() {
    setIapPlusLoading(true)
    setError('')
    try {
      const customerInfo = await rcPurchasePremiumPlus()

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not logged in')

      const entitlement = customerInfo?.entitlements?.active?.['premium_plus']
      const body = {
        originalTransactionId: entitlement?.originalPurchaseDate ? String(entitlement?.productIdentifier || '') : null,
        productId: entitlement?.productIdentifier || PREMIUM_PLUS_PRODUCT_ID,
        expiresDate: entitlement?.expirationDate || null,
        adminUserId: isMember && adminUserId ? adminUserId : null,
        platform: isIOS() ? 'apple' : 'google',
      }

      const res = await fetch(MARK_IAP_PAID_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(body),
      })

      const result = await res.json()
      if (!res.ok || !result?.success) {
        throw new Error(`Purchase succeeded but account update failed: ${result?.error || res.statusText}`)
      }

      setTier('premium_plus')
    } catch (err) {
      if (err?.code === 'PURCHASE_CANCELLED' || err?.message?.toLowerCase().includes('cancel')) {
        setIapPlusLoading(false)
        return
      }
      setError(err.message || 'Premium+ purchase failed. Please try again.')
    } finally {
      setIapPlusLoading(false)
    }
  }

  async function handleRestore() {
    setRestoring(true)
    setError('')
    try {
      await rcRestorePurchases()
      // Build 27: detect WHICH tier was restored so we forward the correct
      // productId to mark-iap-paid. checkPremiumPlusEntitlement() takes
      // priority — Premium+ users only have the premium_plus entitlement,
      // not SeniorSafeApp Pro.
      const hasPremiumPlus = await checkPremiumPlusEntitlement()
      const hasAnyPaid = hasPremiumPlus || (await checkEntitlement())

      if (hasAnyPaid) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Not logged in')

        const res = await fetch(MARK_IAP_PAID_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            productId: hasPremiumPlus ? PREMIUM_PLUS_PRODUCT_ID : PREMIUM_PRODUCT_ID,
            adminUserId: isMember && adminUserId ? adminUserId : null,
            platform: isIOS() ? 'apple' : 'google',
          }),
        })

        const result = await res.json()
        if (!res.ok || !result?.success) {
          throw new Error(`Restore succeeded but account update failed: ${result?.error || res.statusText}`)
        }

        setTier(hasPremiumPlus ? 'premium_plus' : 'paid')
      } else {
        setError('No active subscription found to restore.')
      }
    } catch (err) {
      setError(err.message || 'Could not restore purchases. Please try again later.')
    } finally {
      setRestoring(false)
    }
  }

  const monthlyPrice = '$14.99'
  const annualPrice = '$143.88'
  const annualMonthly = '$11.99'
  const savingsPercent = '20%'

  // Build 27: Premium+ success state (top tier, no further upgrade).
  if (tier === 'premium_plus') {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
        <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="text-white">
              <ArrowLeft size={22} />
            </button>
            <h1 className="text-white text-xl font-bold">Your Plan</h1>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center gap-5">
          <div className="bg-green-100 rounded-2xl p-5">
            <Sparkles size={40} className="text-green-600" strokeWidth={1.5} />
          </div>
          <h2 className="text-[#1B365D] text-xl font-bold">You&apos;re on Premium+!</h2>
          <p className="text-gray-500 text-base leading-relaxed max-w-xs">
            You have everything in Premium plus Maggie, family memory, and Blueprint tools. Thank you for supporting your family&apos;s safety.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full max-w-xs py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // Premium subscriber — still eligible to upgrade to Premium+.
  // On native, show an in-app Premium+ upgrade CTA (Apple/Google handle
  // the proration via the same subscription group). On web, send them
  // back to the dashboard for now (web Premium+ via Stripe is a future
  // ticket).
  if (tier === 'paid') {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
        <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="text-white">
              <ArrowLeft size={22} />
            </button>
            <h1 className="text-white text-xl font-bold">Your Plan</h1>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-10">
          <div className="max-w-lg mx-auto flex flex-col items-center text-center gap-5">
            <div className="bg-green-100 rounded-2xl p-5">
              <CheckCircle size={40} className="text-green-600" strokeWidth={1.5} />
            </div>
            <h2 className="text-[#1B365D] text-xl font-bold">You&apos;re on Premium</h2>
            <p className="text-gray-500 text-base leading-relaxed max-w-xs">
              You have full access to SeniorSafe&apos;s Premium features. Thank you for supporting your family&apos;s safety.
            </p>

            {onNativeStore && (
              <div className="w-full bg-white rounded-2xl p-5 shadow-sm mt-2 text-left">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={18} className="text-[#D4A843]" />
                  <h3 className="text-[#1B365D] font-bold text-base">Add Premium+ for Maggie</h3>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed mb-4">
                  Premium+ adds Maggie, our tactical AI specialist for adult children navigating a parent&apos;s senior transition, plus persistent family memory and Blueprint tools.
                </p>
                <ul className="flex flex-col gap-2.5 mb-4">
                  {PAID_PLUS_FEATURES.slice(1).map((feat, i) => {
                    const Icon = feat.icon
                    return (
                      <li key={i} className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#D4A843]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Icon size={13} className="text-[#D4A843]" strokeWidth={2} />
                        </div>
                        <span className="text-gray-700 text-[14px] leading-snug">{feat.text}</span>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-center text-2xl font-bold text-[#1B365D] mb-1">
                  $39.99<span className="text-base font-normal text-gray-400">/mo total</span>
                </p>
                <p className="text-center text-gray-400 text-xs mb-3">
                  Billed monthly via {isIOS() ? 'Apple' : 'Google Play'}. Cancel anytime.
                </p>
                <button
                  onClick={handlePremiumPlusPurchase}
                  disabled={iapPlusLoading}
                  className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg disabled:opacity-50 shadow-lg"
                >
                  {iapPlusLoading ? 'Processing...' : 'Upgrade to Premium+'}
                </button>
                {error && (
                  <p className="text-red-500 text-sm text-center mt-3">{error}</p>
                )}
                <p className="text-gray-400 text-[11px] text-center mt-3 leading-relaxed">
                  {isIOS()
                    ? 'Payment is charged to your Apple ID. Subscription auto-renews unless canceled at least 24 hours before the end of the current period. Manage in Settings > Apple ID > Subscriptions.'
                    : 'Payment processed by Google Play. Subscription auto-renews. Cancel anytime in Play Store > Subscriptions.'}
                </p>
              </div>
            )}

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full max-w-xs py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg mt-2"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
      {/* Header */}
      <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-white">
            <ArrowLeft size={22} />
          </button>
          <div>
            <h1 className="text-white text-xl font-bold leading-tight">
              {isMember && adminSeniorName
                ? `Upgrade ${adminSeniorName}'s Plan`
                : 'Upgrade Your Plan'}
            </h1>
            <p className="text-white/60 text-sm">
              {isMember
                ? 'Give your family SMS alerts and full access'
                : 'Unlock everything for your family'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-lg mx-auto flex flex-col gap-6">

          {/* Plan toggle — hidden on iOS (only monthly IAP available) */}
          {!onNativeStore && (
            <div className="bg-white rounded-2xl p-1.5 flex shadow-sm">
              <button
                onClick={() => setPlan('monthly')}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  plan === 'monthly'
                    ? 'bg-[#1B365D] text-white'
                    : 'text-gray-500'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setPlan('annual')}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors relative ${
                  plan === 'annual'
                    ? 'bg-[#1B365D] text-white'
                    : 'text-gray-500'
                }`}
              >
                Annual
                <span className="absolute -top-2.5 right-2 bg-[#D4A843] text-[#1B365D] text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Save {savingsPercent}
                </span>
              </button>
            </div>
          )}

          {/* Price display */}
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            {onNativeStore ? (
              <>
                <p className="text-4xl font-bold text-[#1B365D]">{monthlyPrice}<span className="text-lg font-normal text-gray-400">/mo</span></p>
                <p className="text-gray-400 text-sm mt-1">Billed monthly via {isIOS() ? 'Apple' : 'Google Play'}. Cancel anytime.</p>
              </>
            ) : plan === 'monthly' ? (
              <>
                <p className="text-4xl font-bold text-[#1B365D]">{monthlyPrice}<span className="text-lg font-normal text-gray-400">/mo</span></p>
                <p className="text-gray-400 text-sm mt-1">Billed monthly. Cancel anytime.</p>
              </>
            ) : (
              <>
                <p className="text-4xl font-bold text-[#1B365D]">{annualMonthly}<span className="text-lg font-normal text-gray-400">/mo</span></p>
                <p className="text-gray-400 text-sm mt-1">{annualPrice}/year — billed annually</p>
                <p className="text-[#D4A843] text-sm font-semibold mt-1">Save {savingsPercent} vs. monthly</p>
              </>
            )}
          </div>

          {/* Premium features */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={18} className="text-[#D4A843]" />
              <h2 className="text-[#1B365D] font-bold text-lg">Premium Features</h2>
            </div>
            <ul className="flex flex-col gap-3">
              {PAID_FEATURES.map((feat, i) => {
                const Icon = feat.icon
                return (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#D4A843]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon size={13} className="text-[#D4A843]" strokeWidth={2} />
                    </div>
                    <span className="text-gray-700 text-[15px] leading-snug">{feat.text}</span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Free tier comparison */}
          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
            <h3 className="text-gray-500 font-semibold text-sm mb-3 uppercase tracking-wide">Free Plan Includes</h3>
            <ul className="flex flex-col gap-2.5">
              {FREE_FEATURES.map(({ text }, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle size={16} className="text-gray-400 flex-shrink-0 mt-0.5" strokeWidth={2} />
                  <span className="text-gray-500 text-sm leading-snug">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA section — native gives Premium + Premium+ both, web is Stripe Premium */}
          {onNativeStore ? (
            <>
              <button
                onClick={handleIAPPurchase}
                disabled={iapLoading || iapPlusLoading}
                className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg disabled:opacity-50 shadow-lg"
              >
                {iapLoading ? 'Processing...' : `Subscribe to Premium — ${monthlyPrice}/month`}
              </button>

              {/* Build 27: Premium+ tier card with its own Subscribe button. */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border-2 border-[#D4A843]/40">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={18} className="text-[#D4A843]" />
                  <h3 className="text-[#1B365D] font-bold text-base">Or go all-in with Premium+</h3>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed mb-4">
                  Premium+ adds <span className="font-semibold text-[#1B365D]">Maggie</span>, our tactical AI specialist for adult children navigating a parent&apos;s senior transition, plus persistent family memory and Blueprint planning tools.
                </p>
                <ul className="flex flex-col gap-2.5 mb-4">
                  {PAID_PLUS_FEATURES.slice(1).map((feat, i) => {
                    const Icon = feat.icon
                    return (
                      <li key={i} className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#D4A843]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Icon size={13} className="text-[#D4A843]" strokeWidth={2} />
                        </div>
                        <span className="text-gray-700 text-[14px] leading-snug">{feat.text}</span>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-center text-2xl font-bold text-[#1B365D] mb-1">
                  $39.99<span className="text-base font-normal text-gray-400">/mo</span>
                </p>
                <p className="text-center text-gray-400 text-xs mb-3">
                  Billed monthly via {isIOS() ? 'Apple' : 'Google Play'}. Cancel anytime.
                </p>
                <button
                  onClick={handlePremiumPlusPurchase}
                  disabled={iapPlusLoading || iapLoading}
                  className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-bold text-lg disabled:opacity-50 shadow-lg"
                >
                  {iapPlusLoading ? 'Processing...' : 'Subscribe to Premium+'}
                </button>
              </div>

              <button
                onClick={handleRestore}
                disabled={restoring}
                className="w-full py-3 text-[#1B365D] text-sm font-semibold underline disabled:opacity-50"
              >
                {restoring ? 'Restoring...' : 'Restore Purchases'}
              </button>
            </>
          ) : (
            <button
              onClick={handleCheckout}
              disabled={loading || tier === null}
              className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg disabled:opacity-50 shadow-lg"
            >
              {tier === null ? 'Loading...' : loading ? 'Redirecting to checkout...' : `Start Premium — ${plan === 'monthly' ? monthlyPrice + '/mo' : annualMonthly + '/mo'}`}
            </button>
          )}

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <p className="text-gray-400 text-xs text-center">
            {isIOS()
              ? 'Payment is charged to your Apple ID. Subscription automatically renews unless canceled at least 24 hours before the end of the current period. Manage subscriptions in Settings > Apple ID > Subscriptions.'
              : isAndroid()
              ? 'Payment processed by Google Play. Subscription automatically renews. Cancel anytime in Play Store > Subscriptions.'
              : 'Secure payment via Stripe. Cancel anytime from your account settings.'}
          </p>

          <p className="text-center text-xs text-gray-400 pb-4">
            <Link to="/terms" className="underline hover:text-gray-600">Terms of Service</Link>
            {' · '}
            <Link to="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
