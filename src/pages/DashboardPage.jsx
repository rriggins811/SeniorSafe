import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import {
  Shield, CheckCircle, Pill, Calendar, MessageCircle,
  Phone, Heart, LogOut, ChevronRight, Users, AlertTriangle, Settings, Lock, Sparkles,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendSMS } from '../lib/sms'
import { isPremium, trialDaysRemaining } from '../lib/subscription'
import { registerPushNotifications } from '../lib/pushNotifications'
import BottomNav from '../components/BottomNav'
import { dismissKeyboard } from '../lib/dismissKeyboard'

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [redirectMessage, setRedirectMessage] = useState(location.state?.upgradeMessage || '')

  // Clear location.state once consumed so refresh doesn't re-show the message
  useEffect(() => {
    if (location.state?.upgradeMessage) {
      window.history.replaceState({}, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [familyName, setFamilyName] = useState('')
  const [seniorName, setSeniorName] = useState('')
  const [checkInStatus, setCheckInStatus] = useState('idle') // idle | loading | sent | done
  const [lastCheckIn, setLastCheckIn] = useState(null)
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false)
  const [subscriptionTier, setSubscriptionTier] = useState('free')
  const [adminCheckIn, setAdminCheckIn] = useState(null)    // for member view
  const [adminCheckInLoaded, setAdminCheckInLoaded] = useState(false)
  const [medsDue, setMedsDue] = useState(0)
  const [nextAppt, setNextAppt] = useState(null)
  const [msgCount, setMsgCount] = useState(0)
  const [reminding, setReminding] = useState(false)
  const [helpModal, setHelpModal] = useState(false)
  const [helpSending, setHelpSending] = useState(false)
  const [helpSent, setHelpSent] = useState(false)
  const [helpFailed, setHelpFailed] = useState(false)
  const [nudgeCount, setNudgeCount] = useState(0)
  const [nudgeWarning, setNudgeWarning] = useState('')
  const [showCallMenu, setShowCallMenu] = useState(false)
  const [failedNotification, setFailedNotification] = useState(null) // { created_at }
  const [quickDialContacts, setQuickDialContacts] = useState([])
  // Check-in note state (Feature 2)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [checkinNote, setCheckinNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const [lastCheckinId, setLastCheckinId] = useState(null)
  // Daily quote/joke state
  const [dailyQuote, setDailyQuote] = useState(null)
  // Trial countdown
  const [trialDays, setTrialDays] = useState(null) // null = not in trial
  const [showTrialModal, setShowTrialModal] = useState(false)
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false)
  // Review prompt
  const [showReviewPrompt, setShowReviewPrompt] = useState(false)
  // Phone number missing
  const [phoneBannerDismissed, setPhoneBannerDismissed] = useState(false)
  const [smsToast, setSmsToast] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      try {
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
              subscription_tier: 'trial',
              trial_status: 'active',
              trial_start_date: new Date().toISOString(),
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
          // Use profile family_name as source of truth (user_metadata can be stale/mismatched)
          if (p?.family_name) setFamilyName(p.family_name)

          // Register push notifications (native only, no-op on web)
          registerPushNotifications(user.id)

          // Trial countdown
          if (p?.trial_status === 'active' && p?.trial_start_date) {
            const days = trialDaysRemaining(p.trial_start_date)
            setTrialDays(days)
            if (days === 0) setShowTrialModal(true)
          }

          // Review prompt: 7+ days active, 5+ check-ins, max 3 prompts, 30-day cooldown
          if (p?.first_checkin_date && (p?.checkin_count || 0) >= 5 && (p?.review_prompt_count || 0) < 3) {
            const daysSinceFirst = Math.floor((Date.now() - new Date(p.first_checkin_date).getTime()) / (1000 * 60 * 60 * 24))
            const daysSinceLastPrompt = p.review_prompted_date
              ? Math.floor((Date.now() - new Date(p.review_prompted_date).getTime()) / (1000 * 60 * 60 * 24))
              : 999
            if (daysSinceFirst >= 7 && daysSinceLastPrompt >= 30) {
              setShowReviewPrompt(true)
            }
          }

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

      // Failed notification banner — gate on:
      //  1) at least one OTHER family member exists
      //  2) at least one of those members has a phone number
      //  3) actual delivery failure in the last 24 hours
      //  4) banner not dismissed in the last 24 hours (localStorage)
      ;(async () => {
        const dismissedAt = parseInt(localStorage.getItem('seniorsafe_notif_banner_dismissed_at') || '0', 10)
        if (dismissedAt && Date.now() - dismissedAt < 24 * 60 * 60 * 1000) return

        // Look up other family members (same family_name, excluding self)
        const { data: pSelf } = await supabase.from('user_profile')
          .select('family_name')
          .eq('user_id', user.id)
          .single()
        if (!pSelf?.family_name) return

        const { data: family } = await supabase.from('user_profile')
          .select('user_id, phone')
          .eq('family_name', pSelf.family_name)
          .neq('user_id', user.id)

        if (!family || family.length === 0) return
        const anyHasPhone = family.some(m => m.phone && m.phone.trim().length > 0)
        if (!anyHasPhone) return

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: failed } = await supabase.from('notification_log')
          .select('created_at')
          .eq('status', 'failed')
          .gte('created_at', oneDayAgo)
          .order('created_at', { ascending: false })
          .limit(1)
        if (failed?.length) setFailedNotification(failed[0])
      })()

      // Fetch today's daily quote/joke (cycles by day of year)
      // Goal: expand daily_quotes table to 365 entries over time
      const now = new Date()
      const startOfYear = new Date(now.getFullYear(), 0, 0)
      const dayOfYear = Math.floor((now - startOfYear) / 86400000)
      const { count: quoteCount } = await supabase
        .from('daily_quotes')
        .select('id', { count: 'exact', head: true })
      if (quoteCount && quoteCount > 0) {
        const idx = dayOfYear % quoteCount
        const { data: qRow } = await supabase
          .from('daily_quotes')
          .select('content, type, author')
          .order('id')
          .range(idx, idx)
          .single()
        if (qRow) setDailyQuote(qRow)
      }

      } catch (err) {
        console.error('Dashboard data load error:', err)
      }
    })
  }, [navigate])

  // Helper: send push notifications to family members via edge function
  async function sendPushToFamily(userIds, title, body, notificationType, smsFallback) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_ids: userIds,
            title,
            body,
            notification_type: notificationType,
            sms_fallback_message: smsFallback || null,
            data: { route: '/dashboard' },
          }),
        },
      )
    } catch (err) {
      console.error('Push notification error:', err)
    }
  }

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
      if (isPremium(subscriptionTier)) setShowNoteInput(true)
    }

    // Update check-in tracking for review prompt
    const updates = { checkin_count: (profile?.checkin_count || 0) + 1 }
    if (!profile?.first_checkin_date) updates.first_checkin_date = new Date().toISOString()
    supabase.from('user_profile').update(updates).eq('user_id', user.id).then(() => {})

    // Only send notifications for premium tier
    if (isPremium(subscriptionTier)) {
      // Get all family members
      const { data: memberProfiles } = await supabase
        .from('user_profile')
        .select('phone, first_name, user_id, invited_by, role')
        .eq('invited_by', user.id)

      const senderName = user.user_metadata?.first_name || familyName || 'Your loved one'

      if (memberProfiles?.length) {
        // Send push notifications to all members
        const memberIds = memberProfiles.map(m => m.user_id)
        sendPushToFamily(memberIds, 'Check-In', `${senderName} just checked in!`, 'check_in')

        // Send SMS to members with phone numbers
        const membersWithPhone = memberProfiles.filter(m => m.phone)
        if (membersWithPhone.length > 0) {
          await Promise.all(
            membersWithPhone.map(m =>
              sendSMS(m.phone, `✅ ${senderName} just checked in on SeniorSafe and is doing well today. Reply STOP to opt out`)
            )
          )
        } else {
          setSmsToast('Check-in recorded! SMS alerts require phone numbers — add yours in Settings.')
          setTimeout(() => setSmsToast(''), 5000)
        }
      } else {
        setSmsToast('Check-in recorded! Invite family members to receive notifications.')
        setTimeout(() => setSmsToast(''), 5000)
      }

      // Also confirm to the senior's own phone
      const { data: ownProfile } = await supabase
        .from('user_profile')
        .select('phone')
        .eq('user_id', user.id)
        .single()

      if (ownProfile?.phone) {
        await sendSMS(ownProfile.phone, `✅ Your I'm Okay check-in was recorded and your family has been notified - SeniorSafe. Reply STOP to opt out`)
      }
    }

    // Don't auto-close — let note input persist
  }

  async function saveCheckinNote() {
    dismissKeyboard()
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

    // Also post the check-in note to family_messages so it appears in the Family Hub
    // and triggers the family-message-notify edge function (SMS to members).
    // This replaces the direct SMS sending below — the trigger handles it.
    const noteAuthor = user.user_metadata?.first_name || familyName || 'Family'
    await supabase.from('family_messages').insert({
      user_id: user.id,
      family_name: familyName,
      author_name: noteAuthor,
      message_text: `✅ Checked in: "${checkinNote.trim()}"`,
    })

    setNoteSaving(false)
    setNoteSaved(true)
    setShowNoteInput(false)
    setTimeout(() => setNoteSaved(false), 3000)
  }

  async function sendNudge() {
    if (!profile?.invited_by || reminding) return
    if (!isPremium(subscriptionTier)) return // Nudge is paid-only
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

      const { data: memberProfiles } = await supabase
        .from('user_profile')
        .select('phone, first_name, user_id, invited_by, role')
        .eq('invited_by', user.id)

      if (!memberProfiles?.length) {
        console.warn('⚠️ [HELP-ALERT] No family members found! Check invited_by values in user_profile table.')
        alert('No family members found. Ask your family to join through the invite code.')
        setHelpSending(false)
        return
      }

      // Send push + SMS to all family members (belt and suspenders)
      const memberIds = memberProfiles.map(m => m.user_id)
      sendPushToFamily(memberIds, 'Help Requested', `${name} is requesting help. Please check in with them.`, 'help_request', message)

      const membersWithPhone = memberProfiles.filter(m => m.phone)
      if (membersWithPhone.length > 0) {
        const results = await Promise.all(membersWithPhone.map(m =>
          sendSMS(m.phone, message)
        ))
        const successCount = results.filter(Boolean).length

        if (successCount === 0) {
          setHelpSending(false)
          setHelpFailed(true)
          return
        }
      } else {
        setSmsToast('Help alert sent via push. Add phone numbers in Settings for SMS alerts too.')
        setTimeout(() => setSmsToast(''), 5000)
      }

      setHelpSending(false)
      setHelpSent(true)
    } catch {
      setHelpSending(false)
      setHelpFailed(true)
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
  const displayName = familyName || 'Your Family'
  const showMemberWarning = isMember && adminCheckInLoaded && !adminCheckIn && new Date().getHours() >= 10

  return (
    <div className="min-h-screen bg-[#FAF8F4] pb-20">
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-5">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Shield size={22} color="#D4A843" strokeWidth={1.5} />
            <div>
              <p className="text-[#D4A843] font-semibold" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>SENIORSAFE</p>
              <h1 className="text-white leading-tight" style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700 }}>
                {displayName}
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

        {/* Redirect message (e.g., non-admin sent back from /upgrade) */}
        {redirectMessage && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={20} color="#2563EB" className="flex-shrink-0 mt-0.5" />
            <p className="text-blue-800 text-sm flex-1 leading-relaxed">{redirectMessage}</p>
            <button
              onClick={() => setRedirectMessage('')}
              aria-label="Dismiss"
              className="text-blue-400 text-lg leading-none px-1"
            >
              &times;
            </button>
          </div>
        )}

        {/* Failed notification alert banner */}
        {failedNotification && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div
              className="flex-1 cursor-pointer"
              onClick={() => { setFailedNotification(null); navigate('/profile') }}
            >
              <p className="text-orange-800 font-semibold text-sm">Notification delivery issue</p>
              <p className="text-orange-700 text-sm mt-0.5 leading-relaxed">
                We had trouble delivering a notification on{' '}
                {new Date(failedNotification.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
                Please check phone numbers and notification settings in your family profile.
              </p>
              <p className="text-orange-600 text-xs mt-1 underline">Tap to review settings</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                localStorage.setItem('seniorsafe_notif_banner_dismissed_at', Date.now().toString())
                setFailedNotification(null)
              }}
              aria-label="Dismiss"
              className="text-orange-400 text-lg leading-none px-1"
            >
              &times;
            </button>
          </div>
        )}

        {/* Missing phone number banner */}
        {isAdmin && profile && !profile.phone && !phoneBannerDismissed && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <Phone size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-800 font-semibold text-sm">Add your phone number</p>
              <p className="text-amber-700 text-sm mt-0.5 leading-relaxed">
                Add your phone number in Settings to enable SMS alerts for your family.
              </p>
              <button
                onClick={() => navigate('/profile')}
                className="mt-2 px-4 py-2 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-sm"
              >
                Go to Settings
              </button>
            </div>
            <button onClick={() => setPhoneBannerDismissed(true)} className="text-amber-400 text-lg leading-none">&times;</button>
          </div>
        )}

        {/* SMS toast notification */}
        {smsToast && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center gap-3">
            <AlertTriangle size={16} color="#3B82F6" className="flex-shrink-0" />
            <p className="text-blue-800 text-sm flex-1">{smsToast}</p>
            <button onClick={() => setSmsToast('')} className="text-blue-400 text-sm">&times;</button>
          </div>
        )}

        {/* Trial countdown banners */}
        {trialDays !== null && trialDays <= 4 && trialDays > 0 && !trialBannerDismissed && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <Sparkles size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-800 font-semibold text-sm">
                {trialDays === 1
                  ? 'Your free trial ends tomorrow!'
                  : `Your free trial ends in ${trialDays} days`}
              </p>
              <p className="text-amber-700 text-sm mt-0.5 leading-relaxed">
                {trialDays <= 1
                  ? "Don't lose access to AI Assistant, Document Vault, and SMS Alerts."
                  : 'Subscribe to keep all Premium features.'}
              </p>
              <button
                onClick={() => navigate('/upgrade')}
                className="mt-2 px-4 py-2 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-sm"
              >
                Subscribe Now
              </button>
            </div>
            <button onClick={() => setTrialBannerDismissed(true)} className="text-amber-400 text-lg leading-none">&times;</button>
          </div>
        )}

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
            {isPremium(subscriptionTier) ? (
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
              className={`w-full rounded-2xl py-7 flex flex-col items-center gap-2 shadow-md transition-colors ${
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
            {alreadyCheckedIn && !isPremium(subscriptionTier) && (
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
            {showNoteInput && isPremium(subscriptionTier) && (
              <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                <p className="text-[#1B365D] font-semibold text-sm">Add a note for your family (optional)</p>
                <input
                  type="text"
                  value={checkinNote}
                  onChange={e => setCheckinNote(e.target.value)}
                  placeholder='e.g. Going to the store'
                  maxLength={200}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800"
                  style={{ fontSize: '16px' }}
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
            {alreadyCheckedIn && !isPremium(subscriptionTier) && (
              <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                <p className="text-gray-400 text-sm text-center">
                  📝 Add a note with your check-in —{' '}
                  <button onClick={() => navigate('/upgrade')} className="text-[#D4A843] underline font-medium">
                    Premium feature
                  </button>
                </p>
              </div>
            )}

            {/* Daily quote/joke — paid tier */}
            {alreadyCheckedIn && isPremium(subscriptionTier) && dailyQuote && (
              <div className="bg-[#F5E1E6]/40 border border-[#E7E2D8] rounded-2xl p-5 shadow-[0_2px_6px_rgba(45,42,36,0.06)]">
                <p className="text-[#D4A843] font-semibold text-center mb-3" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>
                  {dailyQuote.type === 'quote' ? 'DAILY INSPIRATION' : 'DAILY LAUGH'}
                </p>
                <p className="text-[#1B365D] leading-relaxed text-center" style={{ fontFamily: 'var(--font-display)', fontSize: '17px', fontStyle: 'italic' }}>
                  &ldquo;{dailyQuote.content}&rdquo;
                </p>
                {dailyQuote.author && (
                  <p className="text-[#6B645A] text-sm italic text-right mt-2">{dailyQuote.author}</p>
                )}
              </div>
            )}

            {/* Daily quote teaser — free tier */}
            {alreadyCheckedIn && !isPremium(subscriptionTier) && (
              <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                <p className="text-gray-400 text-sm text-center">
                  ✨ Upgrade to Premium for a daily dose of inspiration —{' '}
                  <button onClick={() => navigate('/upgrade')} className="text-[#D4A843] underline font-medium">
                    Upgrade
                  </button>
                </p>
              </div>
            )}

            {/* I Need Help button — available to all tiers */}
            <button
              onClick={() => setHelpModal(true)}
              className="w-full rounded-2xl py-3 flex items-center justify-center gap-2 bg-[#B5483F] shadow-sm active:scale-[0.98] transition-all"
            >
              <span className="text-white font-semibold" style={{ fontSize: '17px' }}>🆘 I Need Help</span>
            </button>
          </div>
        )}

        {/* ── Speed Dial Contacts ── */}
        {isAdmin && (
          isPremium(subscriptionTier) ? (
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
                <Link
                  to="/upgrade"
                  className="text-[#D4A843] text-xs font-semibold mt-1 inline-block"
                >
                  Upgrade to add speed dial contacts →
                </Link>
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

      {/* Review prompt modal */}
      {showReviewPrompt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-xl text-center">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <Heart size={28} color="#D4A843" strokeWidth={1.5} />
            </div>
            <h2 className="text-[#1B365D] font-bold text-lg">Enjoying SeniorSafe?</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              A quick review helps other families find us and keeps our team motivated!
            </p>
            <button
              onClick={async () => {
                setShowReviewPrompt(false)
                await supabase.from('user_profile').update({
                  review_prompted_date: new Date().toISOString(),
                  review_prompt_count: (profile?.review_prompt_count || 0) + 1,
                }).eq('user_id', user.id)
                // Open App Store review page
                const { isIOS } = await import('../lib/platform')
                if (isIOS()) {
                  window.open('https://apps.apple.com/app/seniorsafe/id6744250582?action=write-review', '_blank')
                } else {
                  window.open('https://apps.apple.com/app/seniorsafe/id6744250582', '_blank')
                }
              }}
              className="w-full py-3.5 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-base"
            >
              Rate SeniorSafe
            </button>
            <button
              onClick={async () => {
                setShowReviewPrompt(false)
                await supabase.from('user_profile').update({
                  review_prompted_date: new Date().toISOString(),
                  review_prompt_count: (profile?.review_prompt_count || 0) + 1,
                }).eq('user_id', user.id)
              }}
              className="text-gray-400 text-sm"
            >
              Not Now
            </button>
          </div>
        </div>
      )}

      {/* Trial expiry modal — last day */}
      {showTrialModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5 shadow-xl text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <Sparkles size={32} color="#D97706" strokeWidth={1.5} />
            </div>
            <h2 className="text-[#1B365D] font-bold text-xl">Your Premium trial ends today</h2>
            <p className="text-gray-500 text-base leading-relaxed">
              After today you'll lose access to:
            </p>
            <ul className="text-gray-600 text-sm text-left space-y-2 px-2">
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> AI Assistant</li>
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> Document Vault</li>
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> Medication Tracking</li>
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> SMS Check-in Alerts</li>
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> Family Messaging</li>
            </ul>
            <button
              onClick={() => { setShowTrialModal(false); navigate('/upgrade') }}
              className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg"
            >
              Subscribe Now — $14.99/mo
            </button>
            <button
              onClick={() => setShowTrialModal(false)}
              className="text-gray-400 text-sm underline"
            >
              Continue with Free
            </button>
          </div>
        </div>
      )}

      {/* I Need Help confirmation modal */}
      {helpModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5 shadow-xl">
            {helpFailed ? (
              /* ---- SMS FAILED — critical safety fallback screen ---- */
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle size={30} color="#DC2626" strokeWidth={2} />
                </div>
                <p className="text-red-700 font-bold text-lg">Text alert failed</p>
                <p className="text-gray-600 text-base leading-relaxed">
                  Please call your family directly to let them know you need help.
                </p>
                <a
                  href="tel:911"
                  className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg text-center block"
                >
                  📞 Call 911
                </a>
                <button
                  onClick={() => { setHelpFailed(false); setHelpModal(false) }}
                  className="w-full py-4 rounded-xl bg-gray-200 text-gray-600 font-semibold text-base"
                >
                  Close
                </button>
              </div>
            ) : helpSent ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle size={48} color="#16A34A" strokeWidth={1.5} />
                <p className="text-green-700 font-bold text-lg">Your family has been alerted.</p>
                <p className="text-gray-500 text-base leading-relaxed">
                  Do you also need emergency services?
                </p>
                <a
                  href="tel:911"
                  className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg text-center block"
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
                    className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg disabled:opacity-60"
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
