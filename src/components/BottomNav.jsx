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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('user_profile').select('subscription_tier').eq('user_id', user.id).single()
        .then(({ data }) => setTier(data?.subscription_tier || 'paid'))
    })
  }, [])

  const isFree = tier === 'free'

  const wrapClass = inline
    ? 'bg-white border-t border-gray-200 flex-shrink-0'
    : 'fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200'

  return (
    <nav className={wrapClass}>
      <div className="flex max-w-lg mx-auto">
        {NAV_TABS.map(({ label, icon: Icon, path, premium }) => {
          const active = pathname === path
          const locked = isFree && premium
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
              </div>
              <span className="text-xs font-medium">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
