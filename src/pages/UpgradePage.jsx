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
  restorePurchases as rcRestorePurchases,
  isNativePlatform,
  checkEntitlement,
  PREMIUM_PRODUCT_ID,
} from '../utils/purchases'

const MARK_IAP_PAID_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/mark-iap-paid'

// ---------------------------------------------------------------------------
// Double-billing modal — shared by the web 409 path (user has active native
// IAP, tried to start a Stripe Checkout) and the native pre-check (user has
// active Stripe sub, tried to start an IAP). RevenueCat does not auto-sync
// from Stripe and our stripe-webhook does not cancel native IAPs, so without
// this gate a user can silently end up with parallel subscriptions.
// ---------------------------------------------------------------------------
function DoubleBillingModal({ open, platform, onClose }) {
  if (!open) return null

  const copy = {
    apple: {
      title: 'Existing App Store subscription',
      body: 'You already have an active SeniorSafe subscription on this Apple ID. To change tiers or cancel, manage it in your iPhone Settings.',
      ctaLabel: 'Open Settings',
      ctaUrl: 'app-settings:',
      ctaTarget: undefined, // app-settings: is a same-app deep link, not a web URL
      footer: 'iPhone Settings → Apple ID → Subscriptions',
    },
    google: {
      title: 'Existing Google Play subscription',
      body: 'You already have an active SeniorSafe subscription on this Google account. To change tiers or cancel, manage it in the Play Store.',
      ctaLabel: 'Open Play Store',
      ctaUrl: 'https://play.google.com/store/account/subscriptions',
      ctaTarget: '_blank',
      footer: 'Play Store → Account → Subscriptions',
    },
    stripe: {
      title: 'Existing web subscription',
      body: 'You already have an active SeniorSafe subscription managed on the web. Sign in there to change or cancel it.',
      ctaLabel: 'Open in browser',
      ctaUrl: 'https://app.seniorsafeapp.com/upgrade',
      ctaTarget: '_blank',
      footer: 'Same login as the app',
    },
  }
  const c = copy[platform] || copy.stripe

  return (
    <div
      className="fixed inset-0 bg-black/55 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="bg-[#D4A843]/15 rounded-xl p-2 flex-shrink-0">
            <Shield size={20} className="text-[#D4A843]" strokeWidth={1.5} />
          </div>
          <h2 className="text-[#1B365D] font-bold text-lg leading-tight pt-1">{c.title}</h2>
        </div>
        <p className="text-gray-700 text-sm leading-relaxed mb-3">{c.body}</p>
        <p className="text-gray-500 text-xs mb-5">{c.footer}</p>
        <div className="flex flex-col gap-2">
          <a
            href={c.ctaUrl}
            target={c.ctaTarget}
            rel={c.ctaTarget === '_blank' ? 'noopener noreferrer' : undefined}
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-base text-center"
          >
            {c.ctaLabel}
          </a>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-base"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

const FREE_FEATURES = [
  { icon: Heart,  text: 'Daily "I\'m Okay" check-in, seen by the family in the app' },
  { icon: Bell,   text: '"I Need Help" alert to the family' },
  { icon: Shield, text: 'Emergency Info card' },
  { icon: Users,  text: '1 invited family member' },
  { icon: Bot,    text: '10 messages with Maggie, total' },
]

const PAID_FEATURES = [
  { icon: Heart,      text: 'A text to the family every time your loved one checks in' },
  { icon: Bell,       text: 'An automatic alert to everyone if they have not checked in by their set time' },
  { icon: Clock,      text: 'A gentle nudge you can send from the app, with a daily limit so it never feels like nagging' },
  { icon: Users,      text: 'Every sibling and caregiver in the loop, no limit' },
  { icon: Bot,        text: 'Maggie every day: everyday help for your parent, real answers about the transition for you, and she remembers your family' },
  { icon: Pill,       text: 'Medication reminders by text, so no dose is missed' },
  { icon: FolderLock, text: 'A secure vault for wills, insurance, and medical records the family can reach when it matters' },
]

export default function UpgradePage() {
  const navigate = useNavigate()
  const [plan, setPlan] = useState('monthly') // 'monthly' or 'annual'
  const [loading, setLoading] = useState(false)
  const [tier, setTier] = useState(null)
  const [error, setError] = useState('')
  const [isMember] = useState(false)
  const [adminUserId] = useState(null)
  const [adminSeniorName] = useState('')
  const [iapLoading, setIapLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  // Double-billing modal: shown when web user has active native IAP (409
  // from create-checkout) OR when native user has active Stripe sub (gated
  // before rcPurchase fires). platform: 'apple' | 'google' | 'stripe'.
  const [billingModalOpen, setBillingModalOpen] = useState(false)
  const [billingModalPlatform, setBillingModalPlatform] = useState('stripe')

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
    const tier = 'premium'
    setLoading(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      console.log('DEBUG session:', session?.access_token ? 'JWT present' : 'JWT MISSING')
      console.log('DEBUG user:', session?.user?.email, 'tier:', tier, 'plan:', plan)

      if (!session) throw new Error('Not logged in')

      const { data, error: fnError } = await supabase.functions.invoke('create-checkout', {
        body: { plan, tier, ...(isMember && adminUserId ? { admin_user_id: adminUserId } : {}) },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (fnError) {
        // C.3: detect the structured 409 ('existing_subscription') and route
        // to the platform-specific double-billing modal instead of the
        // generic error toast. supabase-js wraps the response on
        // fnError.context — read the body to find the error envelope.
        if (fnError.context && typeof fnError.context.json === 'function') {
          try {
            const body = await fnError.context.json()
            if (body?.error === 'existing_subscription' && (body.platform === 'apple' || body.platform === 'google')) {
              setBillingModalPlatform(body.platform)
              setBillingModalOpen(true)
              setLoading(false)
              return
            }
          } catch {
            // body wasn't JSON — fall through to generic error
          }
        }
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

  // C.4: refuse a native IAP purchase if the user already has an active
  // Stripe subscription (created via the web /upgrade flow). RevenueCat does
  // not auto-sync from Stripe, so this is the only place the native side can
  // see the existing web sub. Returns true if the gate fired.
  async function blockIfStripeSub() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { data: profile } = await supabase
      .from('user_profile')
      .select('subscription_platform, stripe_subscription_id, subscription_tier')
      .eq('user_id', user.id)
      .single()
    if (
      profile?.subscription_platform === 'stripe' &&
      profile?.stripe_subscription_id &&
      profile?.subscription_tier && profile.subscription_tier !== 'free'
    ) {
      setBillingModalPlatform('stripe')
      setBillingModalOpen(true)
      return true
    }
    return false
  }

  async function handleIAPPurchase() {
    setIapLoading(true)
    setError('')
    try {
      // C.4 pre-check
      if (await blockIfStripeSub()) {
        setIapLoading(false)
        return
      }

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

  async function handleRestore() {
    setRestoring(true)
    setError('')
    try {
      await rcRestorePurchases()
      const hasAnyPaid = await checkEntitlement()

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
            productId: PREMIUM_PRODUCT_ID,
            adminUserId: isMember && adminUserId ? adminUserId : null,
            platform: isIOS() ? 'apple' : 'google',
          }),
        })

        const result = await res.json()
        if (!res.ok || !result?.success) {
          throw new Error(`Restore succeeded but account update failed: ${result?.error || res.statusText}`)
        }

        setTier('paid')
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

  // Already on the paid plan.
  if (tier === 'paid' || tier === 'premium_plus') {
    return (
      <>
      <DoubleBillingModal
        open={billingModalOpen}
        platform={billingModalPlatform}
        onClose={() => setBillingModalOpen(false)}
      />
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
            <h2 className="text-[#1B365D] text-xl font-bold">You&apos;re on the paid plan</h2>
            <p className="text-gray-500 text-base leading-relaxed max-w-xs">
              Everything is on: check-in texts, the missed check-in alert, reminders, the vault, and Maggie every day. Thank you.
            </p>

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full max-w-xs py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg mt-2"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
      </>
    )
  }

  return (
    <>
    <DoubleBillingModal
      open={billingModalOpen}
      platform={billingModalPlatform}
      onClose={() => setBillingModalOpen(false)}
    />
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
                ? 'Turn on the texts and alerts for your family'
                : 'One plan. Everything on.'}
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
                <p className="text-gray-400 text-sm mt-1">{annualPrice} a year, billed annually</p>
                <p className="text-[#D4A843] text-sm font-semibold mt-1">Save {savingsPercent} vs. monthly</p>
              </>
            )}
          </div>

          {/* Premium features */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={18} className="text-[#D4A843]" />
              <h2 className="text-[#1B365D] font-bold text-lg">The paid plan</h2>
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

          {/* CTA: native buys through the store, web goes to Stripe Checkout */}
          {onNativeStore ? (
            <>
              <button
                onClick={handleIAPPurchase}
                disabled={iapLoading}
                className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg disabled:opacity-50 shadow-lg"
              >
                {iapLoading ? 'Processing...' : `Subscribe, ${monthlyPrice} a month`}
              </button>

              <button
                onClick={handleRestore}
                disabled={restoring}
                className="w-full py-3 text-[#1B365D] text-sm font-semibold underline disabled:opacity-50"
              >
                {restoring ? 'Restoring...' : 'Restore Purchases'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleCheckout()}
                disabled={loading || tier === null}
                className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg disabled:opacity-50 shadow-lg"
              >
                {tier === null ? 'Loading...' : loading ? 'Redirecting to checkout...' : `Subscribe, ${plan === 'monthly' ? monthlyPrice + ' a month' : annualMonthly + ' a month'}`}
              </button>

            </>
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

          <p className="text-center text-xs text-gray-400 pb-2">
            <Link to="/terms" className="underline hover:text-gray-600">Terms of Service</Link>
            {' · '}
            <Link to="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>
          </p>
          {/* Realtor disclosure, required by NC Real Estate Commission rules
              when affiliated activity is referenced. */}
          <p className="text-center text-[10px] text-gray-400 pb-4 leading-relaxed">
            Ryan Riggins · NC Real Estate License #361546 · eXp Realty
          </p>
        </div>
      </div>
    </div>
    </>
  )
}
