import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sendSMS } from '../lib/sms'
import { supabase } from '../lib/supabase'
import { isPremium, trialDaysRemaining } from '../lib/subscription'
import { registerPushNotifications } from '../lib/pushNotifications'
import { dismissKeyboard } from '../lib/dismissKeyboard'
import ParentHome from '../components/homes/ParentHome'
import FamilyHome from '../components/homes/FamilyHome'

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
  const [medsTotal, setMedsTotal] = useState(0)
  const [unreadMsgCount, setUnreadMsgCount] = useState(0)
  const [seniorPhone, setSeniorPhone] = useState('')

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

            supabase.from('user_profile')
              .select('phone')
              .eq('user_id', p.invited_by)
              .single()
              .then(({ data }) => setSeniorPhone(data?.phone || ''))
          } else {
            setAdminCheckInLoaded(true)
          }

          const lastRead = p.last_family_read_at || new Date(0).toISOString()
          if (p.family_name) {
            supabase.from('family_messages')
              .select('id', { count: 'exact', head: true })
              .eq('family_name', p.family_name)
              .gt('created_at', lastRead)
              .neq('user_id', user.id)
              .then(({ count }) => setUnreadMsgCount(count || 0))
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

      // Family-scoped meds (RLS). Don't filter by this user's id — members
      // need the senior's list on the morning board.
      supabase.from('medications').select('id, times, frequency').eq('active', true)
        .then(({ data: meds }) => {
          if (!meds?.length) { setMedsDue(0); setMedsTotal(0); return }
          supabase.from('med_logs')
            .select('medication_id, scheduled_time')
            .eq('date', todayStr)
            .then(({ data: logs }) => {
              let totalDue = 0
              meds.forEach(m => {
                if (m.frequency !== 'As needed') totalDue += (m.times?.length || 1)
              })
              setMedsTotal(totalDue)
              setMedsDue(Math.max(0, totalDue - (logs?.length || 0)))
            })
        })

      supabase.from('appointments')
        .select('title, appointment_date, appointment_time, provider_name')
        .gte('appointment_date', todayStr)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true })
        .limit(1)
        .then(({ data }) => setNextAppt(data?.[0] || null))

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

    // Update check-in tracking for review prompt. Errors here are
    // non-blocking for the user but worth surfacing in console so
    // a regression (e.g., RLS WITH CHECK on user_profile failing)
    // doesn't stay invisible like the original 2026-05-28 incident.
    const updates = { checkin_count: (profile?.checkin_count || 0) + 1 }
    if (!profile?.first_checkin_date) updates.first_checkin_date = new Date().toISOString()
    supabase
      .from('user_profile')
      .update(updates)
      .eq('user_id', user.id)
      .then(({ error: updateError }) => {
        if (updateError) console.error('Check-in tracking update failed:', updateError)
      })

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

  const isMember = profile?.role === 'member'
  const displayName = familyName || 'Your Family'

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="bg-[#1B365D] rounded-2xl p-3">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <p className="text-[#6B645A] text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (isMember) {
    return (
      <FamilyHome
        displayName={displayName}
        seniorName={seniorName}
        adminCheckIn={adminCheckIn}
        adminCheckInLoaded={adminCheckInLoaded}
        medsDue={medsDue}
        medsTotal={medsTotal}
        nextAppt={nextAppt}
        unreadMsgCount={unreadMsgCount}
        seniorPhone={seniorPhone}
        subscriptionTier={subscriptionTier}
        reminding={reminding}
        nudgeCount={nudgeCount}
        nudgeWarning={nudgeWarning}
        onNudge={sendNudge}
        onNavigate={(path) => navigate(path)}
        redirectMessage={redirectMessage}
        onDismissRedirect={() => setRedirectMessage('')}
        failedNotification={failedNotification}
        onOpenFailedNotification={() => { setFailedNotification(null); navigate('/profile') }}
        onDismissFailedNotification={() => {
          localStorage.setItem('seniorsafe_notif_banner_dismissed_at', Date.now().toString())
          setFailedNotification(null)
        }}
        trialDays={trialDays}
        trialBannerDismissed={trialBannerDismissed}
        onDismissTrial={() => setTrialBannerDismissed(true)}
        smsToast={smsToast}
        onDismissToast={() => setSmsToast('')}
      />
    )
  }

  return (
    <ParentHome
      displayName={seniorName || displayName}
      alreadyCheckedIn={alreadyCheckedIn}
      checkInStatus={checkInStatus}
      lastCheckInLabel={formatCheckIn(lastCheckIn)}
      onCheckIn={handleCheckIn}
      medsDue={medsDue}
      onMeds={() => navigate('/medications')}
      quickDialContacts={quickDialContacts}
      dailyQuote={dailyQuote}
      showNoteInput={showNoteInput}
      checkinNote={checkinNote}
      onCheckinNoteChange={setCheckinNote}
      onSaveNote={saveCheckinNote}
      onSkipNote={() => setShowNoteInput(false)}
      noteSaving={noteSaving}
      noteSaved={noteSaved}
      isPremiumUser={isPremium(subscriptionTier)}
      helpModal={helpModal}
      helpFailed={helpFailed}
      helpSent={helpSent}
      helpSending={helpSending}
      onOpenHelp={() => { setHelpFailed(false); setHelpSent(false); setHelpModal(true) }}
      onSendHelp={sendHelpAlert}
      onCloseHelp={() => { setHelpModal(false); setHelpFailed(false); setHelpSent(false) }}
      onSettings={() => navigate('/profile')}
      onSignOut={handleSignOut}
      onAsk={() => navigate('/ai')}
    />
  )
}
