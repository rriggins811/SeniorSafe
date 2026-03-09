import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Shield, CheckCircle, Pill, Calendar, MessageCircle,
  Phone, Heart, LogOut, ChevronRight, Users, AlertTriangle, Settings,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendSMS } from '../lib/sms'
import BottomNav from '../components/BottomNav'

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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      setFamilyName(user.user_metadata?.family_name || '')

      const todayStr = new Date().toISOString().split('T')[0]
      const todayStart = todayStr + 'T00:00:00.000Z'

      // Load profile (includes role + invited_by)
      supabase.from('user_profile').select('*').eq('user_id', user.id).single()
        .then(({ data: p }) => {
          setProfile(p)
          setSeniorName(p?.senior_name || '')
          setSubscriptionTier(p?.subscription_tier || 'paid')

          // If member, check if admin has checked in today
          if (p?.invited_by) {
            supabase.from('checkins')
              .select('checked_in_at')
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

    const { error: checkInError } = await supabase.from('checkins').insert({
      user_id: user.id,
      family_name: familyName,
      checked_in_at: new Date().toISOString(),
    })

    if (checkInError) {
      alert('Check-in failed: ' + checkInError.message)
      setCheckInStatus('idle')
      return
    }

    setLastCheckIn(new Date())
    setAlreadyCheckedIn(true)
    setCheckInStatus('sent')

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
            return sendSMS(m.phone, `✅ ${senderName} just checked in on SeniorSafe and is doing well today.`)
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
        await sendSMS(ownProfile.phone, `✅ Your I'm Okay check-in was recorded and your family has been notified - SeniorSafe`)
      }
    } else {
      console.log('🔍 [CHECK-IN] Skipping SMS — subscriptionTier:', subscriptionTier)
    }

    setTimeout(() => setCheckInStatus('idle'), 3000)
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
        `${senderName} is thinking of you — just tap I'm Okay when you get a chance! — SeniorSafe`
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
      const message = `🆘 URGENT: ${name} pressed "I Need Help" at ${time}. Please check on them immediately. - SeniorSafe Alert`

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
      setTimeout(() => {
        setHelpSent(false)
        setHelpModal(false)
      }, 3000)
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
            <button
              onClick={() => navigate('/contact')}
              className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"
              title="Contact Ryan"
            >
              <Phone size={17} color="white" strokeWidth={1.5} />
            </button>
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
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 flex items-center gap-3">
            <CheckCircle size={22} color="#16A34A" strokeWidth={2} />
            <div>
              <p className="text-green-800 font-semibold text-sm">Checked in today ✓</p>
              <p className="text-green-700 text-sm">{seniorName || 'Your loved one'} is doing well today.</p>
            </div>
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

            {/* I Need Help button — available to all tiers */}
            <button
              onClick={() => setHelpModal(true)}
              className="w-full rounded-2xl py-3 flex items-center justify-center gap-2 bg-red-600 shadow-sm active:scale-[0.98] transition-all"
            >
              <span className="text-white font-semibold" style={{ fontSize: '17px' }}>🆘 I Need Help</span>
            </button>
          </div>
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
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle size={48} color="#16A34A" strokeWidth={1.5} />
                <p className="text-green-700 font-bold text-lg">Help alert sent to your family!</p>
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
