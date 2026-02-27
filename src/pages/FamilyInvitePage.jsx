import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, Copy, CheckCircle, UserMinus, Share2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function FamilyInvitePage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)

      supabase.from('user_profile').select('*').eq('user_id', user.id).single()
        .then(async ({ data: p }) => {
          // If admin has no family_code, generate one now (handles pre-feature accounts)
          if (p && p.role !== 'member' && !p.family_code) {
            const newCode = Math.random().toString(36).substr(2, 6).toUpperCase()
            await supabase.from('user_profile')
              .update({ family_code: newCode, role: 'admin' })
              .eq('user_id', user.id)
            p = { ...p, family_code: newCode, role: 'admin' }
          }

          setProfile(p)

          if (p?.role === 'admin') {
            supabase.from('user_profile')
              .select('user_id, first_name, last_name, family_name, phone, created_at')
              .eq('invited_by', user.id)
              .then(({ data }) => {
                setMembers(data || [])
                setLoading(false)
              })
          } else {
            setLoading(false)
          }
        })
    })
  }, [])

  async function removeMember(memberId) {
    if (!window.confirm('Remove this family member? They will keep their account but be unlinked from yours.')) return
    await supabase.from('user_profile')
      .update({ invited_by: null, role: 'admin' })
      .eq('user_id', memberId)
    setMembers(prev => prev.filter(m => m.user_id !== memberId))
  }

  function copyCode() {
    if (!profile?.family_code) return
    navigator.clipboard.writeText(profile.family_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function shareInvite() {
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const shareText = `Join my family on SeniorSafe to stay coordinated during our transition.\n\nUse invite code: ${profile.family_code}\nSign up at: ${appUrl}/signup`
    if (navigator.share) {
      navigator.share({ title: 'Join me on SeniorSafe', text: shareText })
    } else {
      navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col pb-8">
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-white/70 text-sm mb-4">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <Users size={20} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Family Access</h1>
              <p className="text-white/60 text-sm">Invite family members to SeniorSafe</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-lg mx-auto flex flex-col gap-5">

          {loading ? (
            <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
          ) : !isAdmin ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
              <div className="w-14 h-14 rounded-full bg-[#1B365D]/10 flex items-center justify-center mx-auto mb-3">
                <Users size={28} color="#1B365D" strokeWidth={1.5} />
              </div>
              <p className="text-[#1B365D] font-semibold text-base">You joined as a family member.</p>
              <p className="text-gray-500 text-sm mt-1 leading-relaxed">
                Only the account admin can generate invite codes and manage access.
              </p>
            </div>
          ) : (
            <>
              {/* Invite Code Card */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">
                  Your Family Invite Code
                </p>

                <div className="bg-[#F5F5F5] rounded-xl py-6 flex items-center justify-center mb-4">
                  <span
                    className="text-[#1B365D] font-bold tracking-[0.25em] select-all"
                    style={{ fontSize: '34px' }}
                  >
                    {profile?.family_code || '------'}
                  </span>
                </div>

                <p className="text-gray-500 text-sm text-center mb-4 leading-relaxed">
                  Share this code with family members. When they sign up on SeniorSafe, they enter this code to connect to your account.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={copyCode}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-sm"
                  >
                    {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                    {copied ? 'Copied!' : 'Copy Code'}
                  </button>
                  <button
                    onClick={shareInvite}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-sm"
                  >
                    <Share2 size={16} />
                    Share Invite
                  </button>
                </div>
              </div>

              {/* Member List */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3 px-1">
                  Family Members ({members.length})
                </p>

                {members.length === 0 ? (
                  <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                      <Users size={28} color="#9CA3AF" strokeWidth={1.5} />
                    </div>
                    <p className="text-gray-500 text-sm font-medium">No family members have joined yet.</p>
                    <p className="text-gray-400 text-xs mt-1">Share your invite code above to get started.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {members.map(m => {
                      const displayName = m.first_name
                        ? `${m.first_name}${m.last_name ? ' ' + m.last_name : ''}`
                        : m.family_name || 'Family Member'
                      const initials = (m.first_name?.[0] || m.family_name?.[0] || '?').toUpperCase()
                      return (
                        <div key={m.user_id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-[#1B365D]/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[#1B365D] font-bold text-base">{initials}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[#1B365D] font-semibold text-base leading-tight truncate">
                              {displayName}
                            </p>
                            {m.phone && (
                              <p className="text-gray-400 text-sm mt-0.5">{m.phone}</p>
                            )}
                          </div>
                          <button
                            onClick={() => removeMember(m.user_id)}
                            className="p-2 text-gray-300 hover:text-red-500 flex-shrink-0"
                            title="Remove member"
                          >
                            <UserMinus size={18} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* How it works */}
              <div className="bg-[#1B365D]/5 rounded-2xl p-4">
                <p className="text-[#1B365D] font-semibold text-sm mb-2">How family access works</p>
                <ul className="text-gray-600 text-sm space-y-1.5">
                  <li>• Family members sign up at the app URL</li>
                  <li>• They enter your invite code during signup</li>
                  <li>• They'll receive your "I'm Okay" check-in notifications</li>
                  <li>• They can view the dashboard and support coordination</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
