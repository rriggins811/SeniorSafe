import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { sendSMS } from '../lib/sms'
import { isPremium, trialDaysRemaining } from '../lib/subscription'
import { registerPushNotifications } from '../lib/pushNotifications'
import { copyToClipboard } from '../lib/platform'
import { dismissKeyboard } from '../lib/dismissKeyboard'
import { formatTime12 } from '../lib/time'
import {
  loadFamily, notifyFamily, seniorInviteLink, seniorInviteText, smsHref, sendInvite,
} from '../lib/family'
import ParentHome from '../components/homes/ParentHome'
import FamilyHome from '../components/homes/FamilyHome'

// Two homes, one loader.
//   The senior (is_senior) gets ParentHome: the kiosk with the big button.
//   Everyone else gets FamilyHome: the morning board about the senior.
// Who is who comes from lib/family.js, not from role: an adult child who set
// the family up is the owner (role admin) but is NOT the senior.

function localDayStartIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
function localDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
function isPastAlertTime(hhmm) {
  if (!hhmm) return false
  const [h, m] = hhmm.split(':').map(Number)
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [redirectMessage, setRedirectMessage] = useState(location.state?.upgradeMessage || '')
  useEffect(() => {
    if (location.state?.upgradeMessage) window.history.replaceState({}, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [user, setUser] = useState(null)
  const [family, setFamily] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [seniorCheckIn, setSeniorCheckIn] = useState(null)
  const [seniorCheckInLoaded, setSeniorCheckInLoaded] = useState(false)

  // Senior (kiosk) state
  const [checkInStatus, setCheckInStatus] = useState('idle')
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false)
  const [lastCheckIn, setLastCheckIn] = useState(null)
  const [lastCheckinId, setLastCheckinId] = useState(null)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [checkinNote, setCheckinNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const [helpModal, setHelpModal] = useState(false)
  const [helpSending, setHelpSending] = useState(false)
  const [helpSent, setHelpSent] = useState(false)
  const [helpFailed, setHelpFailed] = useState(false)
  const [quickDialContacts, setQuickDialContacts] = useState([])
  const [dailyQuote, setDailyQuote] = useState(null)

  // Family board state
  const [nudgeCount, setNudgeCount] = useState(0)
  const [reminding, setReminding] = useState(false)
  const [nudgeWarning, setNudgeWarning] = useState('')
  const [copied, setCopied] = useState(false)
  const [unreadMsgCount, setUnreadMsgCount] = useState(0)
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteSentTo, setInviteSentTo] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [history, setHistory] = useState([])   // last 14 days, oldest first

  // Shared
  const [medsDue, setMedsDue] = useState(0)
  const [medsTotal, setMedsTotal] = useState(0)
  const [nextAppt, setNextAppt] = useState(null)
  const [failedNotification, setFailedNotification] = useState(null)
  const [smsToast, setSmsToast] = useState('')
  const [trialDays, setTrialDays] = useState(null)
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { user: u } } = await supabase.auth.getUser()
        if (!u || cancelled) return
        setUser(u)

        const fam = await loadFamily(u.id)
        if (cancelled) return
        if (!fam) { navigate('/onboarding?path=oauth', { replace: true }); return }
        if (!fam.me.onboarding_complete && fam.me.role !== 'member') {
          navigate(`/onboarding?path=${fam.me.is_senior ? 'self' : 'family'}`, { replace: true })
          return
        }
        setFamily(fam)
        registerPushNotifications(u.id)

        const p = fam.me
        const todayStart = localDayStartIso()
        const todayStr = localDateStr()
        const seniorId = fam.senior?.user_id || null

        if (fam.isOwner && p.trial_status === 'active' && p.trial_start_date) {
          setTrialDays(trialDaysRemaining(p.trial_start_date))
        }

        if (seniorId) {
          supabase.from('checkins')
            .select('id, checked_in_at, note')
            .eq('user_id', seniorId)
            .gte('checked_in_at', todayStart)
            .order('checked_in_at', { ascending: false })
            .limit(1)
            .then(({ data }) => {
              const row = data?.[0] || null
              setSeniorCheckIn(row)
              setSeniorCheckInLoaded(true)
              if (row && fam.isSenior) {
                setLastCheckIn(new Date(row.checked_in_at))
                setAlreadyCheckedIn(true)
                setLastCheckinId(row.id)
              }
            })

          // The last 14 days, for the family board. Days before the senior
          // joined are shown as blank, not missed.
          if (!fam.isSenior) {
            const since = new Date()
            since.setDate(since.getDate() - 13)
            since.setHours(0, 0, 0, 0)
            const joinedDay = new Date(fam.senior.created_at)
            joinedDay.setHours(0, 0, 0, 0)
            supabase.from('checkins')
              .select('checked_in_at')
              .eq('user_id', seniorId)
              .gte('checked_in_at', since.toISOString())
              .then(({ data }) => {
                const have = new Set((data || []).map(r => {
                  const d = new Date(r.checked_in_at)
                  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
                }))
                const days = []
                for (let i = 0; i < 14; i++) {
                  const d = new Date(since)
                  d.setDate(since.getDate() + i)
                  days.push({
                    key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
                    label: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
                    dayNum: d.getDate(),
                    checked: have.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`),
                    joined: d >= joinedDay,
                    isToday: i === 13,
                  })
                }
                setHistory(days)
              })
          }

          // The senior's medications and appointments, whoever is looking.
          supabase.from('medications').select('id, times, frequency').eq('user_id', seniorId).eq('active', true)
            .then(({ data: meds }) => {
              if (!meds?.length) { setMedsDue(0); setMedsTotal(0); return }
              supabase.from('med_logs').select('medication_id, scheduled_time').eq('user_id', seniorId).eq('date', todayStr)
                .then(({ data: logs }) => {
                  let totalDue = 0
                  meds.forEach(m => { if (m.frequency !== 'As needed') totalDue += (m.times?.length || 1) })
                  setMedsTotal(totalDue)
                  setMedsDue(Math.max(0, totalDue - (logs?.length || 0)))
                })
            })
          supabase.from('appointments')
            .select('title, appointment_date, appointment_time, provider_name')
            .eq('user_id', seniorId)
            .gte('appointment_date', todayStr)
            .order('appointment_date', { ascending: true })
            .order('appointment_time', { ascending: true })
            .limit(1)
            .then(({ data }) => setNextAppt(data?.[0] || null))
        } else {
          setSeniorCheckInLoaded(true)
        }

        if (fam.familyName) {
          const lastRead = p.last_family_read_at || new Date(0).toISOString()
          supabase.from('family_messages')
            .select('id', { count: 'exact', head: true })
            .eq('family_name', fam.familyName)
            .gt('created_at', lastRead)
            .neq('user_id', u.id)
            .then(({ count }) => setUnreadMsgCount(count || 0))
        }

        if (fam.isSenior) {
          supabase.from('quick_dial_contacts').select('*').eq('user_id', u.id).order('sort_order', { ascending: true }).limit(4)
            .then(({ data }) => setQuickDialContacts(data || []))

          const now = new Date()
          const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)
          const { count: quoteCount } = await supabase.from('daily_quotes').select('id', { count: 'exact', head: true })
          if (quoteCount && quoteCount > 0) {
            const idx = dayOfYear % quoteCount
            const { data: qRow } = await supabase.from('daily_quotes').select('content, type, author').order('id').range(idx, idx).single()
            if (qRow && !cancelled) setDailyQuote(qRow)
          }
        } else {
          supabase.from('nudge_logs').select('id', { count: 'exact', head: true }).eq('sent_by', u.id).eq('date', todayStr)
            .then(({ count }) => setNudgeCount(count || 0))
        }

        // Delivery-failure banner: owner only, last 24h, dismissible for 24h.
        if (fam.isOwner) {
          const dismissedAt = parseInt(localStorage.getItem('seniorsafe_notif_banner_dismissed_at') || '0', 10)
          if (!dismissedAt || Date.now() - dismissedAt >= 86400000) {
            const anyHasPhone = fam.others.some(m => m.phone && m.phone.trim())
            if (anyHasPhone) {
              const oneDayAgo = new Date(Date.now() - 86400000).toISOString()
              const { data: failed } = await supabase.from('notification_log')
                .select('created_at').eq('status', 'failed').gte('created_at', oneDayAgo)
                .order('created_at', { ascending: false }).limit(1)
              if (failed?.length && !cancelled) setFailedNotification(failed[0])
            }
          }
        }
      } catch (err) {
        console.error('Dashboard data load error:', err)
        if (!cancelled) setLoadError('We could not load your home screen. Check your connection and try again.')
      }
    })()
    return () => { cancelled = true }
  }, [navigate])

  // ─── Senior actions ──────────────────────────────────────────────
  async function handleCheckIn() {
    if (checkInStatus !== 'idle' || !user || !family) return
    if (alreadyCheckedIn) {
      setCheckInStatus('sent')
      setTimeout(() => setCheckInStatus('idle'), 3000)
      return
    }
    setCheckInStatus('loading')

    const { data: row, error } = await supabase.from('checkins').insert({
      user_id: user.id,
      family_name: family.familyName,
      checked_in_at: new Date().toISOString(),
    }).select('id').single()

    if (error) {
      alert('Check-in failed: ' + error.message)
      setCheckInStatus('idle')
      return
    }

    setLastCheckIn(new Date())
    setAlreadyCheckedIn(true)
    setCheckInStatus('sent')
    if (row?.id) {
      setLastCheckinId(row.id)
      if (isPremium(family.tier)) setShowNoteInput(true)
    }

    const updates = { checkin_count: (family.me.checkin_count || 0) + 1 }
    if (!family.me.first_checkin_date) updates.first_checkin_date = new Date().toISOString()
    supabase.from('user_profile').update(updates).eq('user_id', user.id)
      .then(({ error: e }) => { if (e) console.error('Check-in tracking update failed:', e) })

    if (!isPremium(family.tier)) return

    const senderName = family.me.first_name || 'Your loved one'
    if (family.others.length === 0) {
      setSmsToast('Check-in recorded. Invite family so they get the text.')
      setTimeout(() => setSmsToast(''), 5000)
      return
    }
    const { texted } = await notifyFamily(family.others, {
      title: 'Check-In',
      body: `${senderName} just checked in!`,
      type: 'check_in',
      sms: `✅ ${senderName} just checked in on SeniorSafe and is doing well today. Reply STOP to opt out`,
    })
    if (texted === 0) {
      setSmsToast('Check-in recorded. Family members need a phone number in Settings to get the text.')
      setTimeout(() => setSmsToast(''), 5000)
    }
    if (family.me.phone) {
      await sendSMS(family.me.phone, `✅ Your I'm Okay check-in was recorded and your family has been notified - SeniorSafe. Reply STOP to opt out`)
    }
  }

  async function saveCheckinNote() {
    dismissKeyboard()
    if (!lastCheckinId || !checkinNote.trim() || noteSaving) return
    setNoteSaving(true)
    const { error } = await supabase.from('checkins').update({ note: checkinNote.trim() }).eq('id', lastCheckinId)
    if (error) { alert('Could not save note: ' + error.message); setNoteSaving(false); return }
    await supabase.from('family_messages').insert({
      user_id: user.id,
      family_name: family.familyName,
      author_name: family.me.first_name || 'Family',
      message_text: `✅ Checked in: "${checkinNote.trim()}"`,
    })
    setNoteSaving(false)
    setNoteSaved(true)
    setShowNoteInput(false)
    setTimeout(() => setNoteSaved(false), 3000)
  }

  async function sendHelpAlert() {
    if (helpSending || !user || !family) return
    setHelpSending(true)
    try {
      const time = fmtTime(new Date())
      const name = family.me.first_name || 'Your loved one'
      const message = `🆘 URGENT: ${name} pressed "I Need Help" at ${time}. Please check on them immediately. - SeniorSafe Alert. Reply STOP to opt out`
      if (family.others.length === 0) {
        alert('No family members found yet. Ask your family to join through your invite link.')
        setHelpSending(false)
        return
      }
      const withPhone = family.others.filter(m => m.phone)
      const { texted } = await notifyFamily(family.others, {
        title: 'Help Requested',
        body: `${name} is requesting help. Please check in with them.`,
        type: 'help_request',
        sms: message,
      })
      if (withPhone.length > 0 && texted === 0) {
        setHelpSending(false)
        setHelpFailed(true)
        return
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

  // ─── Family actions ──────────────────────────────────────────────
  async function sendNudge() {
    if (!family?.senior || reminding) return
    if (!isPremium(family.tier)) return
    if (nudgeCount >= 2) return
    setReminding(true)
    const phone = family.seniorPhone
    if (!phone) {
      alert(`No phone number on file for ${family.seniorName || 'them'} yet. They can add one in Settings.`)
      setReminding(false)
      return
    }
    const senderName = family.me.first_name || 'Your family'
    await sendSMS(phone, `${senderName} is thinking of you. Just tap I'm Okay when you get a chance! SeniorSafe. Reply STOP to opt out`)
    await supabase.from('nudge_logs').insert({ admin_id: family.senior.user_id, sent_by: user.id })
    const n = nudgeCount + 1
    setNudgeCount(n)
    if (n === 2) {
      setNudgeWarning(`You've sent 2 nudges today. If you're worried about ${family.seniorName || 'them'}, it may be time to call or ask someone nearby to check in.`)
    }
    setReminding(false)
  }

  async function copyInvite() {
    await copyToClipboard(seniorInviteLink(family.familyCode))
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  async function textSeniorInvite() {
    if (inviteSending) return
    setInviteSending(true)
    setInviteError('')
    const r = await sendInvite('senior')
    setInviteSending(false)
    if (r.ok) setInviteSentTo(r.to || family.seniorPhone)
    else setInviteError(r.error || 'The text did not go through.')
  }

  // ─── Render ──────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex items-center justify-center px-6">
        <div className="text-center flex flex-col gap-4">
          <p className="text-[#1B365D] text-lg">{loadError}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg">Try again</button>
        </div>
      </div>
    )
  }

  if (!family) {
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

  const { isSenior, isOwner, tier, seniorName } = family
  const displayName = family.familyName || 'Your Family'

  if (isSenior) {
    return (
      <ParentHome
        displayName={family.me.first_name || displayName}
        alreadyCheckedIn={alreadyCheckedIn}
        checkInStatus={checkInStatus}
        lastCheckInLabel={lastCheckIn ? `Today at ${fmtTime(lastCheckIn)}` : null}
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
        isPremiumUser={isPremium(tier)}
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

  const seniorJoined = !!family.senior
  const alertLabel = formatTime12(family.checkinAlertTime)
  const late = seniorJoined && seniorCheckInLoaded && !seniorCheckIn && isPastAlertTime(family.checkinAlertTime)
  const otherMembers = family.others.filter(o => !o.is_senior)
  const inviteText = seniorInviteText({ seniorName, ownerFirstName: family.me.first_name, code: family.familyCode })

  return (
    <FamilyHome
      displayName={displayName}
      seniorName={seniorName}
      seniorJoined={seniorJoined}
      isOwner={isOwner}
      inviteSmsHref={family.seniorPhone ? smsHref(family.seniorPhone, inviteText) : null}
      onSendInvite={textSeniorInvite}
      inviteSending={inviteSending}
      inviteSentTo={inviteSentTo}
      inviteError={inviteError}
      onCopyInvite={copyInvite}
      copied={copied}
      alertLabel={alertLabel}
      late={late}
      adminCheckIn={seniorCheckIn}
      adminCheckInLoaded={seniorCheckInLoaded}
      history={history}
      medsDue={medsDue}
      medsTotal={medsTotal}
      nextAppt={nextAppt}
      unreadMsgCount={unreadMsgCount}
      seniorPhone={family.seniorPhone}
      subscriptionTier={tier}
      reminding={reminding}
      nudgeCount={nudgeCount}
      nudgeWarning={nudgeWarning}
      onNudge={sendNudge}
      showAddFamily={isOwner && otherMembers.length === 0}
      onNavigate={(path) => navigate(path)}
      redirectMessage={redirectMessage}
      onDismissRedirect={() => setRedirectMessage('')}
      failedNotification={failedNotification}
      onOpenFailedNotification={() => { setFailedNotification(null); navigate('/family-invite') }}
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
