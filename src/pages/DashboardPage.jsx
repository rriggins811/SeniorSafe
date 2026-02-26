import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderLock, Bot, Phone, LogOut, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'

const cards = [
  {
    icon: FolderLock,
    iconColor: '#1B365D',
    title: 'Family Vault',
    description: 'Store your important documents securely',
    route: '/vault',
    bg: 'bg-white',
    border: 'border border-gray-200',
  },
  {
    icon: Bot,
    iconColor: '#D4A843',
    title: 'SeniorSafe AI',
    description: 'Get answers about your transition',
    route: '/ai',
    bg: 'bg-white',
    border: 'border border-gray-200',
  },
  {
    icon: Phone,
    iconColor: '#1B365D',
    title: 'Contact Ryan',
    description: 'Your advisor is one tap away',
    route: '/contact',
    bg: 'bg-white',
    border: 'border border-gray-200',
  },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const [familyName, setFamilyName] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.family_name) {
        setFamilyName(user.user_metadata.family_name)
      }
    })
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  const displayName = familyName || 'Your'

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* Header */}
      <div className="bg-[#1B365D] px-6 pt-12 pb-8">
        <div className="max-w-sm mx-auto flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Shield size={28} color="#D4A843" strokeWidth={1.5} />
            <div>
              <p className="text-[#D4A843] text-sm font-medium">SeniorSafe</p>
              <h1 className="text-white text-xl font-bold leading-tight">
                {displayName} Family
              </h1>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-white/70 text-sm py-2 px-3 rounded-lg hover:bg-white/10"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="px-6 py-6 max-w-sm mx-auto flex flex-col gap-4">
        <p className="text-gray-500 text-sm font-medium uppercase tracking-wide">Your tools</p>
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.route}
              onClick={() => navigate(card.route)}
              className={`w-full ${card.bg} ${card.border} rounded-2xl p-5 flex items-center gap-4 shadow-sm active:scale-98`}
            >
              <div className="bg-[#F5F5F5] rounded-xl p-3">
                <Icon size={28} color={card.iconColor} strokeWidth={1.5} />
              </div>
              <div className="flex flex-col items-start text-left">
                <span className="text-[#1B365D] font-semibold text-base">{card.title}</span>
                <span className="text-gray-500 text-sm">{card.description}</span>
              </div>
              <div className="ml-auto text-gray-300">
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
                  <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-6 pb-8 max-w-sm mx-auto">
        <p className="text-center text-xs text-gray-400">
          Riggins Strategic Solutions • Ryan Riggins, Licensed NC Realtor
        </p>
      </div>
    </div>
  )
}
