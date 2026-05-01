import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Home, FolderLock, Users, Bot, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AIMark from './AIMark'

// Base tabs visible to every tier.
const BASE_NAV_TABS = [
  { label: 'Home',   icon: Home,       path: '/dashboard', premium: false, kind: 'lucide' },
  { label: 'Vault',  icon: FolderLock, path: '/vault',     premium: true,  kind: 'lucide' },
  { label: 'Family', icon: Users,      path: '/family',    premium: false, kind: 'lucide' },
  { label: 'AI',     icon: Bot,        path: '/ai',        premium: false, kind: 'lucide' },
]

// Maggie sits ALONGSIDE the daily-buddy SeniorSafe AI, not in place of it.
// Build 27: Maggie tab is visible to ALL tiers — tapping routes free /
// Premium users to the Premium+ paywall; Premium+ users get the chat
// directly. The tier gate is enforced inside MaggiePage, not here.
const MAGGIE_TAB = {
  label: 'Maggie', icon: null, path: '/maggie', premium: false, kind: 'aimark',
}

// inline=true: renders as a normal flow element (use inside h-screen flex-col layouts)
// inline=false (default): fixed to bottom of viewport
export default function BottomNav({ inline = false }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [tier, setTier] = useState('paid')
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelled) return

      const { data: profile } = await supabase
        .from('user_profile')
        .select('subscription_tier, last_family_read_at, family_name, family_code, role, invited_by')
        .eq('user_id', user.id)
        .single()

      if (cancelled) return

      // Members inherit their admin's tier (where the family subscription lives).
      let effectiveTier = profile?.subscription_tier || 'free'
      if (profile?.role === 'member' && profile?.invited_by) {
        const { data: admin } = await supabase
          .from('user_profile')
          .select('subscription_tier')
          .eq('user_id', profile.invited_by)
          .single()
        if (admin?.subscription_tier) effectiveTier = admin.subscription_tier
      }
      if (cancelled) return
      setTier(effectiveTier)

      const familyName = profile?.family_name
      const lastRead = profile?.last_family_read_at || new Date(0).toISOString()

      if (!familyName) return

      const { count } = await supabase
        .from('family_messages')
        .select('id', { count: 'exact', head: true })
        .eq('family_name', familyName)
        .gt('created_at', lastRead)
        .neq('user_id', user.id)

      if (!cancelled) setUnreadCount(count || 0)
    })

    return () => { cancelled = true }
  }, [pathname])

  const isFree = tier === 'free'

  // Build 27: 5-tab layout for everyone. Maggie tab is visible to all
  // tiers — non-Premium+ users get bounced to the upgrade page from
  // MaggiePage (so they can see what they're missing).
  const tabs = [...BASE_NAV_TABS, MAGGIE_TAB]

  const wrapClass = inline
    ? 'bg-[#FAF8F4] border-t border-[#E7E2D8] flex-shrink-0'
    : 'fixed bottom-0 left-0 right-0 z-40 bg-[#FAF8F4] border-t border-[#E7E2D8]'

  return (
    <nav className={wrapClass} style={!inline ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}>
      <div className="flex max-w-lg mx-auto">
        {tabs.map((tab) => {
          const { label, path, premium, kind } = tab
          const Icon = tab.icon
          const active = pathname === path
          const locked = isFree && premium
          const showBadge = label === 'Family' && unreadCount > 0
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[60px] transition-colors ${
                active ? 'text-[#1B365D]' : 'text-[#6B645A]'
              }`}
            >
              {/* Active gold dot indicator above icon */}
              <span className={`block w-1 h-1 rounded-full ${active ? 'bg-[#D4A843]' : 'bg-transparent'}`} aria-hidden="true" />
              <div className="relative">
                {kind === 'aimark' ? (
                  <AIMark size={22} />
                ) : (
                  <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
                )}
                {locked && (
                  <Lock size={10} strokeWidth={2.5} className="absolute -top-1 -right-2.5 text-[#D4A843]" />
                )}
                {showBadge && (
                  <span
                    className="absolute -top-2 -right-3 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[#B5483F] text-white text-[10px] font-bold px-1 leading-none"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-xs font-medium">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
