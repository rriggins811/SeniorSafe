import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isPremiumPlus } from '../lib/subscription'
import AIPage from '../pages/AIPage'
import MaggiePage from '../pages/MaggiePage'

// Routes /ai based on subscription tier.
// Premium+ subscribers see Maggie (Sonnet, transition specialist).
// Free / Premium / Trial users keep SeniorSafe AI (Haiku, daily buddy).
// Members inherit their admin's tier (the family's RevenueCat sub lives on
// the admin's account).
export default function AIRouter() {
  const [tier, setTier] = useState(undefined) // undefined=loading, string=resolved

  useEffect(() => {
    let cancelled = false

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelled) {
        if (!cancelled) setTier(null)
        return
      }
      const { data: profile } = await supabase
        .from('user_profile')
        .select('subscription_tier, role, invited_by')
        .eq('user_id', user.id)
        .single()

      if (cancelled) return

      // Members read tier from their admin (where the subscription lives)
      let effectiveTier = profile?.subscription_tier || 'free'
      if (profile?.role === 'member' && profile?.invited_by) {
        const { data: admin } = await supabase
          .from('user_profile')
          .select('subscription_tier')
          .eq('user_id', profile.invited_by)
          .single()
        if (admin?.subscription_tier) effectiveTier = admin.subscription_tier
      }

      if (!cancelled) setTier(effectiveTier)
    })

    return () => { cancelled = true }
  }, [])

  if (tier === undefined) {
    // Brief loading screen, cream-toned to match the visual overhaul
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex items-center justify-center">
        <p className="text-[#6B645A] italic" style={{ fontSize: '16px' }}>One moment.</p>
      </div>
    )
  }

  return isPremiumPlus(tier) ? <MaggiePage /> : <AIPage />
}
