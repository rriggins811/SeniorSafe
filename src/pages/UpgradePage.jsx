import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield, CheckCircle, X, Sparkles, ArrowLeft,
  Heart, Pill, FolderLock, Bot, Users, Bell, Clock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const CHECKOUT_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/create-checkout'

const FREE_FEATURES = [
  { icon: Heart,  text: 'Daily "I\'m Okay" check-in' },
  { icon: Bell,   text: '"I Need Help" emergency SMS alerts' },
  { icon: Users,  text: '1 family member' },
  { icon: Bot,    text: '10 AI messages per month' },
  { icon: Shield, text: 'Emergency Info card' },
]

const PAID_FEATURES = [
  { icon: Heart,      text: 'Everything in Free, plus:' },
  { icon: Heart,      text: 'I\'m Okay check-in with SMS to family' },
  { icon: Users,      text: 'Unlimited family members' },
  { icon: Bot,        text: 'Unlimited AI messages' },
  { icon: FolderLock, text: 'Document Vault' },
  { icon: Pill,       text: 'Medication tracking & reminders' },
  { icon: Clock,      text: '30-day check-in history' },
  { icon: Bell,       text: 'Missed check-in alerts' },
  { icon: Users,      text: 'Family nudge button' },
]

export default function UpgradePage() {
  const navigate = useNavigate()
  const [plan, setPlan] = useState('monthly') // 'monthly' or 'annual'
  const [loading, setLoading] = useState(false)
  const [tier, setTier] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { navigate('/signin'); return }
      supabase.from('user_profile').select('subscription_tier').eq('user_id', user.id).single()
        .then(({ data }) => setTier(data?.subscription_tier || 'free'))
    })
  }, [navigate])

  async function handleCheckout() {
    setLoading(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not logged in')

      const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ plan }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')

      // Redirect to Stripe Checkout
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const monthlyPrice = '$14.99'
  const annualPrice = '$143.88'
  const annualMonthly = '$11.99'
  const savingsPercent = '20%'

  // Already paid
  if (tier === 'paid') {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
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
            <CheckCircle size={40} className="text-green-600" strokeWidth={1.5} />
          </div>
          <h2 className="text-[#1B365D] text-xl font-bold">You&apos;re on Premium!</h2>
          <p className="text-gray-500 text-base leading-relaxed max-w-xs">
            You have full access to all SeniorSafe features. Thank you for supporting your family&apos;s safety.
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

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Header */}
      <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-white">
            <ArrowLeft size={22} />
          </button>
          <div>
            <h1 className="text-white text-xl font-bold leading-tight">Upgrade to Premium</h1>
            <p className="text-white/60 text-sm">Unlock everything for your family</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-lg mx-auto flex flex-col gap-6">

          {/* Plan toggle */}
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

          {/* Price display */}
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            {plan === 'monthly' ? (
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
              {PAID_FEATURES.map(({ icon: Icon, text }, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#D4A843]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={13} className="text-[#D4A843]" strokeWidth={2} />
                  </div>
                  <span className="text-gray-700 text-[15px] leading-snug">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Free tier comparison */}
          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
            <h3 className="text-gray-500 font-semibold text-sm mb-3 uppercase tracking-wide">Free Plan Includes</h3>
            <ul className="flex flex-col gap-2.5">
              {FREE_FEATURES.map(({ icon: Icon, text }, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle size={16} className="text-gray-400 flex-shrink-0 mt-0.5" strokeWidth={2} />
                  <span className="text-gray-500 text-sm leading-snug">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA button */}
          <button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg disabled:opacity-50 shadow-lg"
          >
            {loading ? 'Redirecting to checkout...' : `Start Premium — ${plan === 'monthly' ? monthlyPrice + '/mo' : annualMonthly + '/mo'}`}
          </button>

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <p className="text-gray-400 text-xs text-center pb-4">
            Secure payment via Stripe. Cancel anytime from your account settings.
          </p>
        </div>
      </div>
    </div>
  )
}
