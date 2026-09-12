import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadFamily } from '../lib/family'
import { Lock, ArrowLeft } from 'lucide-react'
import { MONTHLY_PRICE, TASTE_DAYS, priceLine } from '../lib/subscription'
import { logFunnel } from '../lib/funnel'

// The one lock screen. Every paid feature shows this when the family is on
// the free plan: what it is, the price, one tap to the plan page. A senior
// sees a softer version that points at their family instead of a card.

export default function LockedFeature({ feature, title, description, Icon = Lock, back = '/dashboard' }) {
  const navigate = useNavigate()
  const [who, setWho] = useState({ isSenior: false, ownerName: '' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const fam = await loadFamily(user.id)
      if (!cancelled && fam) setWho({ isSenior: !!fam.isSenior, ownerName: fam.isOwner ? '' : (fam.owner?.first_name || '') })
    })()
    return () => { cancelled = true }
  }, [])
  const { isSenior, ownerName } = who
  const go = () => { logFunnel('lock_tap', feature); navigate(`/upgrade?feature=${encodeURIComponent(feature)}`) }
  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
      <div className="bg-[#1F5A4B] px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate(back)} className="flex items-center gap-2 text-white/70 text-base mb-4"><ArrowLeft size={18} /> Back</button>
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2"><Icon size={22} color="#F2B544" strokeWidth={1.5} /></div>
            <h1 className="text-white font-bold" style={{ fontSize: '22px' }}>{title}</h1>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-14 text-center gap-5 max-w-lg mx-auto w-full">
        <div className="bg-[#1F5A4B] rounded-2xl p-5"><Lock size={40} color="#F2B544" strokeWidth={1.5} /></div>
        <div>
          <h2 className="text-[#1F5A4B] font-bold mb-2" style={{ fontSize: '22px' }}>{title} is on the paid plan</h2>
          <p className="text-[#6B645A] leading-relaxed" style={{ fontSize: '17px' }}>{description}</p>
        </div>
        {isSenior ? (
          <p className="text-[#1F5A4B] leading-relaxed" style={{ fontSize: '17px' }}>
            {ownerName ? `Ask ${ownerName} to turn on the paid plan and this opens for the whole family.` : 'Ask your family to turn on the paid plan and this opens for everyone.'}
          </p>
        ) : (
          <>
            <button onClick={go} className="w-full max-w-xs py-4 rounded-xl bg-[#F2B544] text-[#2D2A24] font-bold" style={{ fontSize: '18px' }}>
              See the paid plan
            </button>
            <p className="text-[#6B645A]" style={{ fontSize: '15px' }}>{priceLine()}</p>
          </>
        )}
        <button onClick={() => navigate(back)} className="text-[#1F5A4B] underline" style={{ fontSize: '16px' }}>Not now</button>
      </div>
    </div>
  )
}
