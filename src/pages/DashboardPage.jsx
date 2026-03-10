import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Shield, CheckCircle, Pill, Calendar, MessageCircle,
  Phone, Heart, LogOut, ChevronRight, Users, AlertTriangle, Settings, Lock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendSMS } from '../lib/sms'
import BottomNav from '../components/BottomNav'
import { Sparkles } from 'lucide-react'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [familyName, setFamilyName] = useState('')
  const [seniorName, setSeniorName] = useState('')
  const [checkInStatus, setCheckInStatus] = useState('idle') // idle | loading | sent | done
  const [lastCheckIn, setLastCheckIn] = useState(null)
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false)
  const [subscriptionTier, setSubscriptionTier] = useState('paid')
  const [adminCheckIn, setAdminCheckIn] = useState(null)    // for member view
  const [adminCheckInLoaded, setAdminCheckInLoaded] = useState(false)
  const [medsDue, setMedsDue] = useState(0)
  const [nextAppt, setNextAppt] = useState(null)
  const [msgCount, setMsgCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [reminding, setReminding] = useState(false)
  const [helpModal, setHelpModal] = useState(false)
  const [helpSending, setHelpSending] = useState(false)
  const [helpSent, setHelpSent] = useState(false)
  const [nudgeCount, setNudgeCount] = useState(0)
  const [nudgeWarning, setNudgeWarning] = useState('')
  const [showCallMenu, setShowCallMenu] = useState(false)
  const [quickDialContacts, setQuickDialContacts] = useState([])
  // Check-in note state (Feature 2)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [checkinNote, setCheckinNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const [lastCheckinId, setLastCheckinId] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      setFamilyName(user.user_metadata?.family_name || '')

      const todayStr = new Date().toISOString().split('T')[0]
      const todayStart = todayStr + 'T00:00:00.000Z'

      // Load profile (includes role + invited_by)
      supabase.from('user_profile').select('*').eq('user_id', user.id).single()
        .then(async ({ data: p }) => {
          // OAuth user with no profile — create minimal record and redirect to onboarding
          if (!p) {
            const meta = user.user_metadata || {}
            const fullName = meta.full_name || meta.name || ''
            await supabase.from('user_profile').insert({
              user_id: user.id,
              first_name: fullName.split(' ')[0] || '',
              last_name: fullName.split(' ').slice(1).join(' ') || '',
              role: 'admin',
              subscription_tier: 'free',
              onboarding_complete: false,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
            navigate('/onboarding')
            return
          }

          // Profile exists but onboarding not complete — redirect
          if (!p.onboarding_complete) {
            navigate('/onboarding')
            return
          }

          setProfile(p)
          setSeniorName(p?.senior_name || '')
          setSubscriptionTier(p?.subscription_tier || 'free')

          // If member, check if admin has checked in today
          if (p?.invited_by) {
            supabase.from('checkins')
              .select('checked_in_at, note')
              .eq('user_id', p.invited_by)
              .gte('checked_in_at', todayStart)
              .order('checked_in_at', { ascending: false })
              .limit(1)
              .then(({ data }) => {
                setAdminCheckIn(data?.[0] || null)
                setAdminCheckInLoaded(true)
              })

            // Fetch today's nudge count from database
            supabase.from('nudge_logs')
              .select('id', { count: 'exact', head: true })
              .eq('sent_by', user.id)
              .eq('date', todayStr)
              .then(({ count }) => setNudgeCount(count || 0))
          } else {
            setAdminCheckInLoaded(true)
          }
        })

      // Last admin's own check-in today
      supabase.from('checkins')
        .select('checked_in_at')
        .eq('user_id', user.id)
        .gte('checked_in_at', todayStart)
        .order('checked_in_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data?.[0]) {
            setLastCheckIn(new Date(data[0].checked_in_at))
            setAlreadyCheckedIn(true)
          }
        })

      // Meds due today
      supabase.from('medications').select('id, times, frequency').eq('user_id', user.id).eq('active', true)
        .then(({ data: meds }) => {
          if (!meds?.length) { setMedsDue(0); return }
          supabase.from('med_logs')
            .select('medication_id, scheduled_time')
            .eq('user_id', user.id)
            .eq('date', todayStr)
            .then(({ data: logs }) => {
              let totalDue = 0
              meds.forEach(m => {
                if (m.frequency !== 'As needed') totalDue += (m.times?.length || 1)
              })
              setMedsDue(Math.max(0, totalDue - (logs?.length || 0)))
            })
        })

      // Next upcoming appointment
      supabase.from('appointments')
        .select('title, appointment_date, appointment_time, provider_name')
        .eq('user_id', user.id)
        .gte('appointment_date', todayStr)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true })
        .limit(1)
        .then(({ data }) => setNextAppt(data?.[0] || null))

      // Family message count (RLS scopes to family via family_name)
      supabase.from('family_messages')
        .select('id', { count: 'exact', head: true })
        .then(({ count }) => setMsgCount(count || 0))

      // Quick dial contacts (up to 4)
      supabase.from('quick_dial_contacts')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true })
        .limit(4)
        .then(({ data }) => setQuickDialContacts(data || []))

      setLoading(false)
    })
  }, [])

  async function handleCheckIn() {
    if (checkInStatus !== 'idle' || !user) return
    if (alreadyCheckedIn) {
      setCheckInStatus('sent')
      setTimeout(() => setCheckInStatus('idle'), 3000)
      return
    }
    setCheckInStatus('loading')

    const { data: checkInData, error: checkInError } = await supabase.from('checkins').insert({
      user_id: user.id,
      family_name: familyName,
      checked_in_at: new Date().toISOString(),
    }).select('id').single()

    if (checkInError) {
      alert('Check-in failed: ' + checkInError.message)
      setCheckInStatus('idle')
      return
    }

    setLastCheckIn(new Date())
    setAlreadyCheckedIn(true)
    setCheckInStatus('sent')
    if (checkInData?.id) {
      setLastCheckinId(checkInData.id)
      if (subscriptionTier === 'paid') setShowNoteInput(true)
    }

    // Only send SMS for paid tier
    if (subscriptionTier === 'paid') {
      // DEBUG: log the admin user.id being used for the query
      console.log('🔍 [CHECK-IN] Admin user.id:', user.id)
      console.log('🔍 [CHECK-IN] subscriptionTier:', subscriptionTier)

      // Notify all family members who have a phone number
      const { data: memberProfiles, error: memberErr } = await supabase
        .from('user_profile')
        .select('phone, first_name, user_id, invited_by, role')
        .eq('invited_by', user.id)
        .not('phone', 'is', null)

      console.log('🔍 [CHECK-IN] Query: user_profile WHERE invited_by =', user.id, 'AND phone IS NOT NULL')
      console.log('🔍 [CHECK-IN] memberProfiles result:', JSON.stringify(memberProfiles, null, 2))
      console.log('🔍 [CHECK-IN] memberProfiles error:', memberErr)
      console.log('🔍 [CHECK-IN] Members found:', memberProfiles?.length || 0)

      // DEBUG: also query ALL profiles with this family_code to see what's in the DB
      const { data: allFamily } = await supabase
        .from('user_profile')
        .select('user_id, first_name, phone, role, invited_by, family_code')
        .or(`invited_by.eq.${user.id},user_id.eq.${user.id}`)
      console.log('🔍 [CHECK-IN] ALL family profiles (admin + members):', JSON.stringify(allFamily, null, 2))

      const senderName = user.user_metadata?.first_name || familyName || 'Your loved one'

      if (memberProfiles?.length) {
        console.log('🔍 [CHECK-IN] Sending SMS to these phones:', memberProfiles.map(m => m.phone))
        await Promise.all(
          memberProfiles.map(m => {
            console.log('🔍 [CHECK-IN] → Sending to', m.first_name, 'at', m.phone)
            return sendSMS(m.phone, `✅ ${senderName} just checked in on SeniorSafe and is doing well today. Reply STOP to opt out`)
          })
        )
      } else {
        console.warn('⚠️ [CHECK-IN] No family members found with phones! SMS only going to senior.')
      }

      // Also confirm to the senior's own phone
      const { data: ownProfile } = await supabase
        .from('user_profile')
        .select('phone')
        .eq('user_id', user.id)
        .single()

      console.log('🔍 [CHECK-IN] Senior own phone:', ownProfile?.phone)

      if (ownProfile?.phone) {
        await sendSMS(ownProfile.phone, `✅ Your I'm Okay check-in was recorded and your family has been notified - SeniorSafe. Reply STOP to opt out`)
      }
    } else {
      console.log('🔍 [CHECK-IN] Skipping SMS — subscriptionTier:', subscriptionTier)
    }

    // Don't auto-close — let note input persist
  }

  async function saveCheckinNote() {
    if (!lastCheckinId || !checkinNote.trim() || noteSaving) return
    setNoteSaving(true)

    // Save note to checkin record
    const { error } = await supabase
      .from('checkins')
      .update({ note: checkinNote.trim() })
      .eq('id', lastCheckinId)

    if (error) {
      alert('Could not save note: ' + error.message)
      setNoteSaving(false)
      return
    }

    // Send follow-up SMS to family with the note (paid tier already confirmed)
    const senderName = seniorName || user.user_metadata?.first_name || familyName || 'Your loved one'
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

    const { data: memberProfiles } = await supabase
      .from('user_profile')
      .select('phone')
      .eq('invited_by', user.id)
      .not('phone', 'is', null)

    if (memberProfiles?.length) {
      await Promise.all(
        memberProfiles.map(m =>
          sendSMS(m.phone, `${senderName} checked in at ${time} — "${checkinNote.trim()}" — SeniorSafe. Reply STOP to opt out`)
        )
      )
    }

    setNoteSaving(false)
    setNoteSaved(true)
    setShowNoteInput(false)
    setTimeout(() => setNoteSaved(false), 3000)
  }

  async function sendNudge() {
    if (!profile?.invited_by || reminding) return
    if (subscriptionTier !== 'paid') return // Nudge is paid-only
    if (nudgeCount >= 2) return // Daily limit reached
    setReminding(true)

    const { data: adminProfile } = await supabase
      .from('user_profile')
      .select('phone, first_name')
      .eq('user_id', profile.invited_by)
      .single()

    if (adminProfile?.phone) {
      const senderName = user.user_metadata?.first_name || profile?.first_name || 'Your family'
      await sendSMS(
        adminProfile.phone,
        `${senderName} is thinking of you — just tap I'm Okay when you get a chance! — SeniorSafe. Reply STOP to opt out`
      )
    } else {
      alert("No phone number on file for this account holder — they can add one in Settings.")
      setReminding(false)
      return
    }

    // Log nudge to database (date defaults to CURRENT_DATE server-side)
    await supabase.from('nudge_logs').insert({
      admin_id: profile.invited_by,
      sent_by: user.id,
    })

    const newCount = nudgeCount + 1
    setNudgeCount(newCount)

    const name = seniorName || 'your loved one'
    if (newCount === 2) {
      setNudgeWarning(
        `You\u2019ve sent 2 nudges today. If you\u2019re worried about ${name}, it may be time to give them a call or ask someone nearby to check in on them.`
      )
    }

    setReminding(false)
  }

  async function sendHelpAlert() {
    if (helpSending || !user) return
    setHelpSending(true)

    try {
      const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      const name = seniorName || user.user_metadata?.first_name || familyName || 'Your loved one'
      const message = `🆘 URGENT: ${name} pressed "I Need Help" at ${time}. Please check on them immediately. - SeniorSafe Alert. Reply STOP to opt out`

      // DEBUG: log the admin user.id being used for the query
      console.log('🔍 [HELP-ALERT] Admin user.id:', user.id)

      const { data: memberProfiles, error: memberErr } = await supabase
        .from('user_profile')
        .select('phone, first_name, user_id, invited_by, role')
        .eq('invited_by', user.id)
        .not('phone', 'is', null)

      console.log('🔍 [HELP-ALERT] Query: user_profile WHERE invited_by =', user.id, 'AND phone IS NOT NULL')
      console.log('🔍 [HELP-ALERT] memberProfiles result:', JSON.stringify(memberProfiles, null, 2))
      console.log('🔍 [HELP-ALERT] memberProfiles error:', memberErr)
      console.log('🔍 [HELP-ALERT] Members found:', memberProfiles?.length || 0)

      // DEBUG: also dump all profiles to see what invited_by values exist
      const { data: allProfiles } = await supabase
        .from('user_profile')
        .select('user_id, first_name, phone, role, invited_by, family_code')
      console.log('🔍 [HELP-ALERT] ALL user_profile rows:', JSON.stringify(allProfiles, null, 2))

      if (!memberProfiles?.length) {
        console.warn('⚠️ [HELP-ALERT] No family members found! Check invited_by values in user_profile table.')
        alert('No family members with phone numbers found. Ask your family to add their phone number in the app.')
        setHelpSending(false)
        return
      }

      console.log('🔍 [HELP-ALERT] Sending SMS to these phones:', memberProfiles.map(m => m.phone))
      const results = await Promise.all(memberProfiles.map(m => {
        console.log('🔍 [HELP-ALERT] → Sending to', m.first_name, 'at', m.phone)
        return sendSMS(m.phone, message)
      }))
      const successCount = results.filter(Boolean).length

      if (successCount === 0) {
        alert('Could not send alerts right now. Please call your family directly.')
        setHelpSending(false)
        return
      }

      setHelpSending(false)
      setHelpSent(true)
    } catch {
      alert('Something went wrong sending alerts. Please call your family directly.')
      setHelpSending(false)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  function formatCheckIn(date) {
    if (!date) return null
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    return `Today at ${time}`
  }

  function formatApptDate(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function formatTelHref(phone) {
    const digits = phone.replace(/\D/g, '')
    if (digits.length === 10) return `tel:+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
    return `tel:${digits}`
  }

  const isMember = profile?.role === 'member'
  const isAdmin = !isMember
  const isSent = checkInStatus === 'sent'
  const displayName = familyName || 'Your'
  const showMemberWarning = isMember && adminCheckInLoaded && !adminCheckIn && new Date().getHours() >= 10

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-5">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Shield size={22} color="#D4A843" strokeWidth={1.5} />
            <div>
              <p className="text-[#D4A843] text-xs font-semibold tracking-wide">SENIORSAFE</p>
              <h1 className="text-white font-bold leading-tight" style={{ fontSize: '18px' }}>
                {displayName} Family
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => navigate('/family-invite')}
                className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"
                title="Family Invite"
              >
                <Users size={17} color="white" strokeWidth={1.5} />
              </button>
            )}
            <button
              onClick={() => navigate('/profile')}
              className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"
              title="Profile & Settings"
            >
              <Settings size={17} color="white" strokeWidth={1.5} />
            </button>
            <button
              onClick={() => navigate('/emergency')}
              className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center"
              title="Emergency Info"
            >
              <Heart size={17} color="#EF4444" strokeWidth={0} fill="#EF4444" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowCallMenu(!showCallMenu)}
                className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"
                title="Call"
              >
                <Phone size={17} color="white" strokeWidth={1.5} />
              </button>
              {showCallMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCallMenu(false)} />
                  <div className="absolute top-12 right-0 z-50 bg-white rounded-xl shadow-lg py-2 w-48">
                    <a
                      href="tel:911"
                      className="flex items-center gap-3 px-4 py-3 text-red-600 font-bold text-base hover:bg-red-50"
                      onClick={() => setShowCallMenu(false)}
                    >
                      <Phone size={16} strokeWidth={2} />
                      Call 911
                    </a>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={() => { setShowCallMenu(false); navigate('/contact') }}
                      className="flex items-center gap-3 px-4 py-3 text-[#1B365D] font-semibold text-base hover:bg-gray-50 w-full text-left"
                    >
                      <MessageCircle size={16} strokeWidth={1.5} />
                      Contact Ryan
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={handleSignOut}
              className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"
              title="Sign out"
            >
              <LogOut size={17} color="rgba(255,255,255,0.7)" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 pb-4 max-w-lg mx-auto flex flex-col gap-5">

        {/* Member: no check-in warning banner */}
        {showMemberWarning && (
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-800 font-semibold text-sm">No check-in yet today</p>
                <p className="text-yellow-700 text-sm mt-0.5 leading-relaxed">
                  {seniorName || 'Your loved one'} hasn&apos;t tapped &ldquo;I&apos;m Okay&rdquo; yet today.
                </p>
              </div>
            </div>
            {subscriptionTier === 'paid' ? (
              nudgeCount >= 2 ? (
                <div className="w-full py-3 px-4 rounded-xl bg-yellow-50 border border-yellow-300 text-center">
                  <p className="text-yellow-800 text-sm leading-relaxed">
                    You&apos;ve reached your nudge limit for today. If you haven&apos;t heard from{' '}
                    <span className="font-semibold">{seniorName || 'your loved one'}</span>, please
                    reach out directly or contact someone who can check on them in person.
                  </p>
                </div>
              ) : (
                <>
                  <button
                    onClick={sendNudge}
                    disabled={reminding}
                    className="w-full py-3 rounded-xl bg-yellow-400 text-yellow-900 font-semibold text-sm disabled:opacity-60"
                  >
                    {reminding ? 'Sending...' : '💛 Send a Nudge'}
                  </button>
                  {nudgeWarning && (
                    <p className="text-yellow-700 text-sm mt-1 leading-relaxed px-1">
                      {nudgeWarning}
                    </p>
                  )}
                </>
              )
            ) : (
              <div className="w-full py-3 rounded-xl bg-gray-100 text-center">
                <p className="text-gray-500 text-sm">
                  💛 Nudge available on{' '}
                  <button onClick={() => navigate('/upgrade')} className="text-[#1B365D] underline font-semibold">Premium</button>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Member: check-in confirmed */}
        {isMember && adminCheckInLoaded && adminCheckIn && (
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 flex items-start gap-3">
            <CheckCircle size={22} color="#16A34A" strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-green-800 font-semibold text-sm">Checked in today ✓</p>
              <p className="text-green-700 text-sm">{seniorName || 'Your loved one'} is doing well today.</p>
              {adminCheckIn.note && (
                <p className="text-green-700 text-sm mt-1 italic">&ldquo;{adminCheckIn.note}&rdquo;</p>
              )}
            </div>
          </div>
        )}

        {/* Member upsell — free tier only */}
        {isMember && adminCheckInLoaded && subscriptionTier === 'free' && (
          <div className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center justify-between">
            <p className="text-gray-500 text-sm">
              ✓ Viewed in app.{' '}
              <span className="text-gray-400">Want this as a text?</span>
            </p>
            <button
              onClick={() => navigate('/upgrade')}
              className="text-[#D4A843] text-sm font-semibold whitespace-nowrap flex items-center gap-1"
            >
              <Sparkles size={14} /> Upgrade
            </button>
          </div>
        )}

        {/* I'm Okay button — admin only */}
        {isAdmin && (
          <div className="flex flex-col gap-2">
            <button
              onClick={handleCheckIn}
              disabled={checkInStatus === 'loading' || alreadyCheckedIn}
              className={`w-full rounded-2xl py-7 flex flex-col items-center gap-2 shadow-md transition-all active:scale-[0.98] ${
                isSent || alreadyCheckedIn ? 'bg-green-500' : 'bg-[#1B365D]'
              }`}
            >
              <div className="flex items-center gap-3">
                <CheckCircle
                  size={32}
                  color={isSent || alreadyCheckedIn ? 'white' : '#D4A843'}
                  strokeWidth={isSent || alreadyCheckedIn ? 2.5 : 1.5}
                />
                <span className="text-white font-bold" style={{ fontSize: '22px' }}>
                  {isSent || alreadyCheckedIn ? '✓ Checked In' : "I'm Okay Today"}
                </span>
              </div>
              <span className="text-white/75" style={{ fontSize: '15px' }}>
                {alreadyCheckedIn
                  ? "You've already checked in today. Check back tomorrow!"
                  : isSent
                  ? 'Your family has been notified'
                  : "Tap to let your family know you're doing well"}
              </span>
            </button>
            <p className="text-center text-sm text-gray-400">
              {lastCheckIn
                ? `Last check-in: ${formatCheckIn(lastCheckIn)}`
                : 'No check-in today yet'}
            </p>
            {alreadyCheckedIn && subscriptionTier !== 'paid' && (
              <p className="text-center text-sm text-gray-400">
                ✓ Family can see this in the app.{' '}
                <button onClick={() => navigate('/upgrade')} className="text-[#D4A843] underline font-medium">
                  Upgrade to also send them a text.
                </button>
              </p>
            )}

            {/* Note saved confirmation */}
            {noteSaved && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <p className="text-green-700 text-sm font-semibold">✓ Note sent to your family!</p>
              </div>
            )}

            {/* Check-in note input — paid tier */}
            {showNoteInput && subscriptionTier === 'paid' && (
              <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                <p className="text-[#1B365D] font-semibold text-sm">Add a note for your family (optional)</p>
                <input
                  type="text"
                  value={checkinNote}
                  onChange={e => setCheckinNote(e.target.value)}
                  placeholder='e.g. Going to the store'
                  maxLength={200}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveCheckinNote}
                    disabled={!checkinNote.trim() || noteSaving}
                    className="flex-1 py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-sm disabled:opacity-40"
                  >
                    {noteSaving ? 'Sending...' : 'Send Note'}
                  </button>
                  <button
                    onClick={() => setShowNoteInput(false)}
                    className="px-5 py-3 rounded-xl bg-gray-200 text-gray-600 font-semibold text-sm"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}

            {/* Check-in note teaser — free tier */}
            {alreadyCheckedIn && subscriptionTier !== 'paid' && (
              <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                <p className="text-gray-400 text-sm text-center">
                  📝 Add a note with your check-in —{' '}
                  <button onClick={() => navigate('/upgrade')} className="text-[#D4A843] underline font-medium">
                    Premium feature
                  </button>
                </p>
              </div>
            )}

            {/* I Need Help button — available to all tiers */}
            <button
              onClick={() => setHelpModal(true)}
              className="w-full rounded-2xl py-3 flex items-center justify-center gap-2 bg-red-600 shadow-sm active:scale-[0.98] transition-all"
            >
              <span className="text-white font-semibold" style={{ fontSize: '17px' }}>🆘 I Need Help</span>
            </button>
          </div>
        )}

        {/* ── Speed Dial Contacts ── */}
        {isAdmin && (
          subscriptionTier === 'paid' ? (
            quickDialContacts.length > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 px-1">
                  Speed Dial
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {quickDialContacts.map(c => (
                    <a
                      key={c.id}
                      href={formatTelHref(c.phone)}
                      className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-sm active:opacity-80"
                    >
                      <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
                        <Phone size={18} color="#16A34A" strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[#1B365D] font-bold text-sm truncate">{c.label}</p>
                        <p className="text-gray-400 text-xs truncate">{c.name}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-5 text-center shadow-sm">
                <Phone size={24} color="#D1D5DB" strokeWidth={1.5} className="mx-auto mb-2" />
                <p className="text-gray-400 text-sm">No speed dial contacts yet.</p>
                <button
                  onClick={() => navigate('/profile')}
                  className="text-[#1B365D] text-sm font-semibold underline mt-1"
                >
                  Add contacts in Settings
                </button>
              </div>
            )
          ) : (
            <div className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Lock size={22} color="#9CA3AF" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <p className="text-[#1B365D] font-semibold text-sm">Speed Dial Contacts</p>
                <p className="text-gray-400 text-xs mt-0.5">Upgrade to add speed dial contacts.</p>
                <a
                  href="sms:+13365538933?body=I%27d%20like%20to%20upgrade%20my%20SeniorSafe%20account"
                  className="text-[#D4A843] text-xs font-semibold mt-1 inline-block"
                >
                  Text Ryan to Upgrade →
                </a>
              </div>
            </div>
          )
        )}

        {/* ── Today at a glance ── */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 px-1">
            Today at a glance
          </p>
          <div className="flex flex-col gap-3">

            {/* Medications */}
            <button
              onClick={() => navigate('/medications')}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:opacity-80"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Pill size={24} color="#2563EB" strokeWidth={1.5} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>
                  Today&apos;s Medications
                </p>
                <p className="text-gray-500 text-sm">
                  {medsDue > 0
                    ? `${medsDue} dose${medsDue !== 1 ? 's' : ''} remaining`
                    : 'All doses taken ✓'}
                </p>
              </div>
              <ChevronRight size={18} color="#D1D5DB" />
            </button>

            {/* Appointments */}
            <button
              onClick={() => navigate('/appointments')}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:opacity-80"
            >
              <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                <Calendar size={24} color="#7C3AED" strokeWidth={1.5} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>
                  Upcoming Appointments
                </p>
                <p className="text-gray-500 text-sm">
                  {nextAppt
                    ? `${nextAppt.title} — ${formatApptDate(nextAppt.appointment_date)}`
                    : 'No upcoming appointments'}
                </p>
              </div>
              <ChevronRight size={18} color="#D1D5DB" />
            </button>

            {/* Family Messages */}
            <button
              onClick={() => navigate('/family')}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:opacity-80"
            >
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={24} color="#16A34A" strokeWidth={1.5} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>
                  Family Messages
                </p>
                <p className="text-gray-500 text-sm">
                  {msgCount > 0 ? `${msgCount} message${msgCount !== 1 ? 's' : ''}` : 'No messages yet'}
                </p>
              </div>
              <ChevronRight size={18} color="#D1D5DB" />
            </button>

          </div>
        </div>

        <p className="text-center text-xs text-gray-300 pb-1">
          Riggins Strategic Solutions • Ryan Riggins, Licensed NC Realtor
        </p>
        <p className="text-center text-xs text-gray-300 pb-2">
          <Link to="/terms" className="underline hover:text-gray-500">Terms of Service</Link>
          {' | '}
          <Link to="/privacy" className="underline hover:text-gray-500">Privacy Policy</Link>
        </p>
      </div>

      {/* I Need Help confirmation modal */}
      {helpModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5 shadow-xl">
            {helpSent ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle size={48} color="#16A34A" strokeWidth={1.5} />
                <p className="text-green-700 font-bold text-lg">Your family has been alerted.</p>
                <p className="text-gray-500 text-base leading-relaxed">
                  Do you also need emergency services?
                </p>
                <a
                  href="tel:911"
                  className="w-full py-4 rounded-xl bg-red-600 text-white font-bold text-lg text-center block"
                >
                  📞 Call 911
                </a>
                <button
                  onClick={() => { setHelpSent(false); setHelpModal(false) }}
                  className="w-full py-4 rounded-xl bg-gray-200 text-gray-600 font-semibold text-base"
                >
                  I don&apos;t need 911 — go back home
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertTriangle size={30} color="#DC2626" strokeWidth={2} />
                  </div>
                  <h2 className="text-[#1B365D] font-bold text-xl">Are you sure?</h2>
                  <p className="text-gray-500 text-base leading-relaxed">
                    This will send an urgent alert to your entire family.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={sendHelpAlert}
                    disabled={helpSending}
                    className="w-full py-4 rounded-xl bg-red-600 text-white font-bold text-lg disabled:opacity-60"
                  >
                    {helpSending ? 'Sending...' : 'Yes, Send Alert'}
                  </button>
                  <button
                    onClick={() => setHelpModal(false)}
                    disabled={helpSending}
                    className="w-full py-4 rounded-xl bg-gray-300 text-gray-700 font-semibold text-lg disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
