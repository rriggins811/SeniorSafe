import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, Copy, CheckCircle, UserMinus, Share2, MessageSquare, Clock, Heart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateFamilyCode } from '../lib/familyCode'
import { copyToClipboard } from '../lib/platform'
import {
  loadFamily, seniorInviteLink, seniorInviteText, memberInviteLink, memberInviteText, smsHref,
} from '../lib/family'

// The owner's view of who is in the family, who still needs to join, and how
// to invite them. Members see the same list, read-only.
export default function FamilyInvitePage() {
  const navigate = useNavigate()
  const [family, setFamily] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState('')
  const [showAgeGate, setShowAgeGate] = useState(false) // COPPA age gate
  const [ageGateAction, setAgeGateAction] = useState(null)
  const [showAgeBlocked, setShowAgeBlocked] = useState(false)

  async function reload() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    let fam = await loadFamily(user.id)
    // Pre-feature owners may have no code yet; mint one.
    if (fam && fam.isOwner && !fam.familyCode) {
      const code = await generateFamilyCode()
      await supabase.from('user_profile').update({ family_code: code }).eq('user_id', user.id)
      fam = await loadFamily(user.id)
    }
    setFamily(fam)
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      let fam = await loadFamily(user.id)
      if (fam && fam.isOwner && !fam.familyCode) {
        const code = await generateFamilyCode()
        await supabase.from('user_profile').update({ family_code: code }).eq('user_id', user.id)
        fam = await loadFamily(user.id)
      }
      if (cancelled) return
      setFamily(fam)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  async function removeMember(memberId) {
    if (!window.confirm('Remove this family member? They keep their account but will no longer see this family.')) return
    await supabase.from('user_profile').update({ invited_by: null, role: 'admin' }).eq('user_id', memberId)
    reload()
  }

  async function copy(text, key) {
    await copyToClipboard(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2500)
  }

  async function share(text) {
    if (navigator.share) {
      try { await navigator.share({ title: 'Join me on SeniorSafe', text }) } catch { /* cancelled */ }
    } else {
      await copy(text, 'share')
    }
  }

  function gated(action) {
    setAgeGateAction(() => action)
    setShowAgeGate(true)
  }

  const isOwner = !!family?.isOwner
  const code = family?.familyCode || ''
  const seniorName = family?.seniorName || ''
  const seniorJoined = !!family?.senior
  const tier = family?.tier || 'free'
  const members = (family?.all || []).filter(r => r.user_id !== family?.ownerId && !r.is_senior)
  const FREE_MEMBER_LIMIT = 1
  const atFreeLimit = tier === 'free' && members.length >= FREE_MEMBER_LIMIT

  const memberText = memberInviteText({ seniorName, code })
  const seniorText = seniorInviteText({ seniorName, ownerFirstName: family?.me?.first_name, code })

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col pb-8">
      <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-white/70 text-base mb-4"><ArrowLeft size={18} /> Back</button>
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2"><Users size={20} color="#D4A843" strokeWidth={1.5} /></div>
            <div>
              <h1 className="text-white font-bold" style={{ fontSize: '22px' }}>Family</h1>
              <p className="text-white/60 text-sm">Who gets the check-in, and how to add more people</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-lg mx-auto flex flex-col gap-5">
          {loading || !family ? (
            <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
          ) : (
            <>
              {/* The senior */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">Checks in each day</p>
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${seniorJoined ? 'bg-green-50' : 'bg-[#D4A843]/20'}`}>
                    {seniorJoined ? <Heart size={20} color="#16A34A" /> : <Clock size={20} color="#8A6A1E" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[#1B365D] font-semibold" style={{ fontSize: '17px' }}>{seniorName || 'Not set yet'}</p>
                    <p className="text-gray-500 text-sm">{seniorJoined ? 'Has the app and can check in' : 'Has not opened their link yet'}</p>
                  </div>
                </div>
                {isOwner && !seniorJoined && !family.isSenior && (
                  <div className="flex flex-col gap-2 mt-4">
                    {family.seniorPhone && (
                      <a href={smsHref(family.seniorPhone, seniorText)} className="w-full py-3.5 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-base flex items-center justify-center gap-2">
                        <MessageSquare size={18} /> Text {seniorName || 'them'} the link
                      </a>
                    )}
                    <button onClick={() => copy(seniorInviteLink(code), 'senior')} className="w-full py-3.5 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-base flex items-center justify-center gap-2">
                      {copied === 'senior' ? <><CheckCircle size={18} /> Copied</> : <><Copy size={18} /> Copy {seniorName ? `${seniorName}'s` : 'their'} link</>}
                    </button>
                  </div>
                )}
              </div>

              {/* Invite family members */}
              {isOwner && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">Invite family members</p>
                  <p className="text-gray-600 text-base leading-relaxed mb-4">
                    Siblings, a spouse, a caregiver. Everyone who joins gets the daily check-in text and can send a nudge.
                  </p>
                  <div className="bg-[#FAF8F4] rounded-xl py-4 flex flex-col items-center gap-1 mb-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Family code</p>
                    <span className="text-[#1B365D] font-bold tracking-[0.25em] select-all" style={{ fontSize: '32px' }}>{code || '------'}</span>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => gated(() => copy(memberInviteLink(code), 'member'))} className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-base">
                      {copied === 'member' ? <><CheckCircle size={18} /> Copied</> : <><Copy size={18} /> Copy link</>}
                    </button>
                    <button onClick={() => gated(() => share(memberText))} className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-base">
                      <Share2 size={18} /> Share
                    </button>
                  </div>
                </div>
              )}

              {atFreeLimit && isOwner && (
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 text-center">
                  <p className="text-yellow-800 font-semibold text-base mb-1">The free plan includes 1 family member</p>
                  <p className="text-yellow-700 text-base mb-3 leading-relaxed">Premium lets everyone in the family join.</p>
                  <button onClick={() => navigate('/upgrade')} className="px-6 py-2.5 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-base">See Premium</button>
                </div>
              )}

              {/* Member list */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3 px-1">
                  Family members ({members.length}{tier === 'free' ? `/${FREE_MEMBER_LIMIT}` : ''})
                </p>
                {members.length === 0 ? (
                  <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3"><Users size={28} color="#9CA3AF" strokeWidth={1.5} /></div>
                    <p className="text-gray-500 text-base font-medium">No one else has joined yet.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {members.map(m => {
                      const displayName = m.first_name ? `${m.first_name}${m.last_name ? ' ' + m.last_name : ''}` : 'Family Member'
                      const initials = (m.first_name?.[0] || '?').toUpperCase()
                      const isMe = m.user_id === family.me.user_id
                      return (
                        <div key={m.user_id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-[#1B365D]/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[#1B365D] font-bold text-base">{initials}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[#1B365D] font-semibold text-base leading-tight truncate">{displayName}{isMe ? ' (you)' : ''}{m.user_id === family.ownerId ? ' · set up the family' : ''}</p>
                            <p className="text-gray-400 text-sm mt-0.5">{m.phone ? m.phone : 'No phone number, will not get texts'}</p>
                          </div>
                          {isOwner && m.user_id !== family.ownerId && (
                            <button onClick={() => removeMember(m.user_id)} className="p-2 text-gray-300 hover:text-red-500 flex-shrink-0" title="Remove member" aria-label="Remove member">
                              <UserMinus size={18} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showAgeGate && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowAgeGate(false)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl p-6 max-w-sm mx-auto shadow-xl">
            <h3 className="text-[#1B365D] font-bold text-lg text-center mb-3">Quick check</h3>
            <p className="text-gray-600 text-base text-center leading-relaxed mb-5">Is the person you're inviting 13 or older?</p>
            <div className="flex flex-col gap-3">
              <button onClick={() => { setShowAgeGate(false); ageGateAction && ageGateAction() }} className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-base">Yes, they are 13 or older</button>
              <button onClick={() => { setShowAgeGate(false); setShowAgeBlocked(true) }} className="w-full py-4 rounded-xl border border-gray-300 text-gray-600 font-semibold text-base">No</button>
            </div>
          </div>
        </>
      )}
      {showAgeBlocked && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowAgeBlocked(false)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl p-6 max-w-sm mx-auto shadow-xl">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center"><UserMinus size={28} color="#DC2626" strokeWidth={1.5} /></div>
              <h3 className="text-[#1B365D] font-bold text-lg">Not available</h3>
              <p className="text-gray-600 text-base leading-relaxed">SeniorSafe is for people 13 and older.</p>
              <button onClick={() => setShowAgeBlocked(false)} className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-base mt-2">Got it</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
