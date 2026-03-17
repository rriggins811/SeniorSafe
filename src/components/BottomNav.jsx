import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Home, FolderLock, Users, Bot, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'

const NAV_TABS = [
  { label: 'Home',   icon: Home,       path: '/dashboard', premium: false },
  { label: 'Vault',  icon: FolderLock, path: '/vault',     premium: true  },
  { label: 'Family', icon: Users,      path: '/family',    premium: false },
  { label: 'AI',     icon: Bot,        path: '/ai',        premium: false },
]

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

      // Fetch tier and last_family_read_at in one query
      const { data: profile } = await supabase
        .from('user_profile')
        .select('subscription_tier, last_family_read_at, family_name, family_code, role, invited_by')
        .eq('user_id', user.id)
        .single()

      if (cancelled) return
      setTier(profile?.subscription_tier || 'free')

      // Get the family_name for querying family_messages
      const familyName = profile?.family_name
      const lastRead = profile?.last_family_read_at || new Date(0).toISOString()

      if (!familyName) return

      // Count unread messages: created after last_family_read_at, not by current user
      const { count } = await supabase
        .from('family_messages')
        .select('id', { count: 'exact', head: true })
        .eq('family_name', familyName)
        .gt('created_at', lastRead)
        .neq('user_id', user.id)

      if (!cancelled) setUnreadCount(count || 0)
    })

    return () => { cancelled = true }
  }, [pathname]) // Re-check on every navigation

  const isFree = tier === 'free'

  const wrapClass = inline
    ? 'bg-white border-t border-gray-200 flex-shrink-0'
    : 'fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200'

  return (
    <nav className={wrapClass}>
      <div className="flex max-w-lg mx-auto">
        {NAV_TABS.map((tab) => {
          const { label, path, premium } = tab
          const Icon = tab.icon
          const active = pathname === path
          const locked = isFree && premium
          const showBadge = label === 'Family' && unreadCount > 0
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[60px] transition-colors ${
                active ? 'text-[#1B365D]' : 'text-gray-400'
              }`}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
                {locked && (
                  <Lock size={10} strokeWidth={2.5} className="absolute -top-1 -right-2.5 text-[#D4A843]" />
                )}
                {showBadge && (
                  <span
                    className="absolute -top-2 -right-3 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[#EF4444] text-white text-[10px] font-bold px-1 leading-none"
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
