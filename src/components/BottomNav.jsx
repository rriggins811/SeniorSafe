import { useNavigate, useLocation } from 'react-router-dom'
import { Home, FolderLock, Users, Bot } from 'lucide-react'

const NAV_TABS = [
  { label: 'Home',   icon: Home,       path: '/dashboard' },
  { label: 'Vault',  icon: FolderLock, path: '/vault'     },
  { label: 'Family', icon: Users,      path: '/family'    },
  { label: 'AI',     icon: Bot,        path: '/ai'        },
]

// inline=true: renders as a normal flow element (use inside h-screen flex-col layouts)
// inline=false (default): fixed to bottom of viewport
export default function BottomNav({ inline = false }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const wrapClass = inline
    ? 'bg-white border-t border-gray-200 flex-shrink-0'
    : 'fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200'

  return (
    <nav className={wrapClass}>
      <div className="flex max-w-lg mx-auto">
        {NAV_TABS.map(({ label, icon: Icon, path }) => {
          const active = pathname === path
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[60px] transition-colors ${
                active ? 'text-[#1B365D]' : 'text-gray-400'
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
