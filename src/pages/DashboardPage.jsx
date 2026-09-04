import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import {
  Shield, CheckCircle, Pill, Calendar, MessageCircle, Phone, Heart, LogOut,
  ChevronRight, Users, AlertTriangle, Settings, Lock, Sparkles, Clock, Copy, Share2, MessageSquare,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendSMS } from '../lib/sms'
import { isPremium, trialDaysRemaining } from '../lib/subscription'
import { registerPushNotifications } from '../lib/pushNotifications'
import { copyToClipboard } from '../lib/platform'
import BottomNav from '../components/BottomNav'
import { dismissKeyboard } from '../lib/dismissKeyboard'
import { formatTime12 } from '../lib/time'
import {
  loadFamily, notifyFamily, seniorInviteLink, seniorInviteText, smsHref, telHref,
} from '../lib/family'

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
  const [family, setFamily] = useState(null)   // see lib/family.js
  const [seniorCheckIn, setSeniorCheckIn] = useState(null) // { checked_in_at, note } today
  const [loaded, setLoaded] = useState(false)

  // Elder view state
  const [checkInStatus, setCheckInStatus] = useState('idle') // idle | loading | sent
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
  const [showReviewPrompt, setShowReviewPrompt] = useState(false)

  // Family view state
  const [nudgeCount, setNudgeCount] = useState(0)
  const [reminding, setReminding] = useState(false)
  const [nudgeWarning, setNudgeWarning] = useState('')
  const [copied, setCopied] = useState(false)

  // Shared
  const [medsDue, setMedsDue] = useState(0)
  const [nextAppt, setNextAppt] = useState(null)
  const [msgCount, setMsgCount] = useState(0)
  const [showCallMenu, setShowCallMenu] = useState(false)
  const [failedNotification, setFailedNotification] = useState(null)
  const [smsToast, setSmsToast] = useState('')
  const [trialDays, setTrialDays] = useState(null)
  const [showTrialModal, setShowTrialModal] = useState(false)
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false)
  const [phoneBannerDismissed, setPhoneBannerDismissed] = useState(false)

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
          const days = trialDaysRemaining(p.trial_start_date)
          setTrialDays(days)
          if (days === 0) setShowTrialModal(true)
        }

        // Today's check-in by the senior (that is "me" in the elder view).
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
              if (row && fam.isSenior) {
                setLastCheckIn(new Date(row.checked_in_at))
                setAlreadyCheckedIn(true)
                setLastCheckinId(row.id)
              }
            })

          // The senior's medications and appointments, whoever is looking.
          supabase.from('medications').select('id, times, frequency').eq('user_id', seniorId).eq('active', true)
            .then(({ data: meds }) => {
              if (!meds?.length) { setMedsDue(0); return }
              supabase.from('med_logs').select('medication_id, scheduled_time').eq('user_id', seniorId).eq('date', todayStr)
                .then(({ data: logs }) => {
                  let totalDue = 0
                  meds.forEach(m => { if (m.frequency !== 'As needed') totalDue += (m.times?.length || 1) })
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
        }

        supabase.from('family_messages').select('id', { count: 'exact', head: true })
          .then(({ count }) => setMsgCount(count || 0))

        if (fam.isSenior) {
          supabase.from('quick_dial_contacts').select('*').eq('user_id', u.id).order('sort_order', { ascending: true }).limit(4)
            .then(({ data }) => setQuickDialContacts(data || []))

          if (p.first_checkin_date && (p.checkin_count || 0) >= 5 && (p.review_prompt_count || 0) < 3) {
            const daysSinceFirst = Math.floor((Date.now() - new Date(p.first_checkin_date).getTime()) / 86400000)
            const daysSinceLastPrompt = p.review_prompted_date ? Math.floor((Date.now() - new Date(p.review_prompted_date).getTime()) / 86400000) : 999
            if (daysSinceFirst >= 7 && daysSinceLastPrompt >= 30) setShowReviewPrompt(true)
          }

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

        // Delivery-failure banner (owner only, last 24h, dismissible for 24h)
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
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [navigate])

  // ─── Elder actions ───────────────────────────────────────────────
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
      if (withPhone.length === 0) {
        setSmsToast('Help alert sent by push. Family members can add a phone number in Settings for texts too.')
        setTimeout(() => setSmsToast(''), 5000)
      }
      setHelpSending(false)
      setHelpSent(true)
    } catch {
      setHelpSending(false)
      setHelpFailed(true)
    }
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
    await sendSMS(phone, `${senderName} is thinking of you. Just tap I'm Okay when you get a chance! - SeniorSafe. Reply STOP to opt out`)
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

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  function formatApptDate(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (!loaded || !family) {
    return <div className="min-h-screen bg-[#FAF8F4]" />
  }

  const { isSenior, isOwner, tier, seniorName } = family
  const premium = isPremium(tier)
  const isSent = checkInStatus === 'sent'
  const displayName = family.familyName || 'Your Family'
  const seniorJoined = !!family.senior
  const alertLabel = formatTime12(family.checkinAlertTime)
  const late = seniorJoined && !seniorCheckIn && isPastAlertTime(family.checkinAlertTime)

  return (
    <div className="min-h-screen bg-[#FAF8F4] pb-20">
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-5">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Shield size={22} color="#D4A843" strokeWidth={1.5} />
            <div className="min-w-0">
              <p className="text-[#D4A843] font-semibold" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>SENIORSAFE</p>
              <h1 className="text-white leading-tight truncate" style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700 }}>
                {displayName}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <button onClick={() => navigate('/family-invite')} className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center" title="Family" aria-label="Family and invites">
                <Users size={17} color="white" strokeWidth={1.5} />
              </button>
            )}
            <button onClick={() => navigate('/profile')} className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center" title="Settings" aria-label="Settings">
              <Settings size={17} color="white" strokeWidth={1.5} />
            </button>
            <button onClick={() => navigate('/emergency')} className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center" title="Emergency Info" aria-label="Emergency info">
              <Heart size={17} color="#EF4444" strokeWidth={0} fill="#EF4444" />
            </button>
            <div className="relative">
              <button onClick={() => setShowCallMenu(!showCallMenu)} className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center" title="Call" aria-label="Call">
                <Phone size={17} color="white" strokeWidth={1.5} />
              </button>
              {showCallMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCallMenu(false)} />
                  <div className="absolute top-12 right-0 z-50 bg-white rounded-xl shadow-lg py-2 w-48">
                    <a href="tel:911" className="flex items-center gap-3 px-4 py-3 text-red-600 font-bold text-base hover:bg-red-50" onClick={() => setShowCallMenu(false)}>
                      <Phone size={16} strokeWidth={2} /> Call 911
                    </a>
                    <div className="border-t border-gray-100" />
                    <button onClick={() => { setShowCallMenu(false); navigate('/contact') }} className="flex items-center gap-3 px-4 py-3 text-[#1B365D] font-semibold text-base hover:bg-gray-50 w-full text-left">
                      <MessageCircle size={16} strokeWidth={1.5} /> Contact Ryan
                    </button>
                  </div>
                </>
              )}
            </div>
            {!isSenior && (
              <button onClick={handleSignOut} className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center" title="Sign out" aria-label="Sign out">
                <LogOut size={17} color="rgba(255,255,255,0.7)" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 pb-4 max-w-lg mx-auto flex flex-col gap-5">

        {redirectMessage && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={20} color="#2563EB" className="flex-shrink-0 mt-0.5" />
            <p className="text-blue-800 text-base flex-1 leading-relaxed">{redirectMessage}</p>
            <button onClick={() => setRedirectMessage('')} aria-label="Dismiss" className="text-blue-400 text-lg leading-none px-1">&times;</button>
          </div>
        )}

        {failedNotification && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1 cursor-pointer" onClick={() => { setFailedNotification(null); navigate('/family-invite') }}>
              <p className="text-orange-800 font-semibold text-base">A notification did not go through</p>
              <p className="text-orange-700 text-base mt-0.5 leading-relaxed">
                On {new Date(failedNotification.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Check that everyone in the family has a phone number.
              </p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); localStorage.setItem('seniorsafe_notif_banner_dismissed_at', Date.now().toString()); setFailedNotification(null) }} aria-label="Dismiss" className="text-orange-400 text-lg leading-none px-1">&times;</button>
          </div>
        )}

        {!isSenior && isOwner && !family.me.phone && !phoneBannerDismissed && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <Phone size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-800 font-semibold text-base">Add your mobile number</p>
              <p className="text-amber-700 text-base mt-0.5 leading-relaxed">The check-in text can't reach you without it.</p>
              <button onClick={() => navigate('/profile')} className="mt-2 px-4 py-2 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-base">Add it in Settings</button>
            </div>
            <button onClick={() => setPhoneBannerDismissed(true)} className="text-amber-400 text-lg leading-none" aria-label="Dismiss">&times;</button>
          </div>
        )}

        {smsToast && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center gap-3">
            <AlertTriangle size={16} color="#3B82F6" className="flex-shrink-0" />
            <p className="text-blue-800 text-base flex-1">{smsToast}</p>
            <button onClick={() => setSmsToast('')} className="text-blue-400" aria-label="Dismiss">&times;</button>
          </div>
        )}

        {isOwner && trialDays !== null && trialDays <= 4 && trialDays > 0 && !trialBannerDismissed && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <Sparkles size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-800 font-semibold text-base">
                {trialDays === 1 ? 'Your free trial ends tomorrow' : `Your free trial ends in ${trialDays} days`}
              </p>
              <p className="text-amber-700 text-base mt-0.5 leading-relaxed">
                After that, the missed check-in alert and check-in texts stop. Subscribe to keep them.
              </p>
              <button onClick={() => navigate('/upgrade')} className="mt-2 px-4 py-2 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-base">Subscribe</button>
            </div>
            <button onClick={() => setTrialBannerDismissed(true)} className="text-amber-400 text-lg leading-none" aria-label="Dismiss">&times;</button>
          </div>
        )}

        {/* ══════════ FAMILY VIEW (adult child, sibling, caregiver) ══════════ */}
        {!isSenior && (
          <>
            {!seniorJoined ? (
              <div className="bg-white rounded-2xl p-5 shadow-sm border-2 border-[#D4A843]/50 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-full bg-[#D4A843]/20 flex items-center justify-center flex-shrink-0">
                    <Clock size={22} color="#8A6A1E" />
                  </div>
                  <div>
                    <p className="text-[#1B365D] font-bold" style={{ fontSize: '19px' }}>Waiting for {seniorName || 'them'} to join</p>
                    <p className="text-[#6B645A] mt-1 leading-relaxed" style={{ fontSize: '16px' }}>
                      {seniorName || 'They'} {seniorName ? 'needs' : 'need'} SeniorSafe on their phone. Once they open the link, their check-ins show up here.
                    </p>
                  </div>
                </div>
                {isOwner && (
                  <div className="flex flex-col gap-2">
                    {family.seniorPhone ? (
                      <a href={smsHref(family.seniorPhone, seniorInviteText({ seniorName, ownerFirstName: family.me.first_name, code: family.familyCode }))}
                        className="w-full py-3.5 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-base flex items-center justify-center gap-2">
                        <MessageSquare size={18} /> Text {seniorName || 'them'} the link again
                      </a>
                    ) : null}
                    <button onClick={copyInvite} className="w-full py-3.5 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-base flex items-center justify-center gap-2">
                      {copied ? <><CheckCircle size={18} /> Copied</> : <><Copy size={18} /> Copy the link</>}
                    </button>
                  </div>
                )}
              </div>
            ) : seniorCheckIn ? (
              <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 flex items-start gap-3">
                <CheckCircle size={28} color="#16A34A" strokeWidth={2} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-800 font-bold" style={{ fontSize: '20px' }}>{seniorName} checked in</p>
                  <p className="text-green-700 mt-0.5" style={{ fontSize: '16px' }}>Today at {fmtTime(new Date(seniorCheckIn.checked_in_at))}</p>
                  {seniorCheckIn.note && <p className="text-green-800 mt-2 italic" style={{ fontSize: '16px' }}>&ldquo;{seniorCheckIn.note}&rdquo;</p>}
                </div>
              </div>
            ) : (
              <div className={`rounded-2xl p-5 flex flex-col gap-4 border-2 ${late ? 'bg-red-50 border-red-300' : 'bg-white border-[#E7E2D8]'}`}>
                <div className="flex items-start gap-3">
                  {late
                    ? <AlertTriangle size={28} color="#B5483F" className="flex-shrink-0 mt-0.5" />
                    : <Clock size={28} color="#6B645A" className="flex-shrink-0 mt-0.5" />}
                  <div>
                    <p className={`font-bold ${late ? 'text-red-800' : 'text-[#1B365D]'}`} style={{ fontSize: '20px' }}>
                      {late ? `No check-in from ${seniorName} yet` : `${seniorName} hasn't checked in yet`}
                    </p>
                    <p className={`mt-0.5 ${late ? 'text-red-700' : 'text-[#6B645A]'}`} style={{ fontSize: '16px' }}>
                      {late ? `It's past their ${alertLabel} check-in time.` : `Their check-in time is ${alertLabel}.`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {premium ? (
                    nudgeCount >= 2 ? (
                      <p className="flex-1 text-[#6B645A] text-sm leading-relaxed px-1">You've sent 2 nudges today. If you haven't heard from {seniorName}, call or ask someone nearby to check in.</p>
                    ) : (
                      <button onClick={sendNudge} disabled={reminding} className="flex-1 py-3.5 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-base disabled:opacity-60">
                        {reminding ? 'Sending...' : 'Send a nudge'}
                      </button>
                    )
                  ) : (
                    <button onClick={() => navigate('/upgrade')} className="flex-1 py-3.5 rounded-xl bg-gray-100 text-[#1B365D] font-semibold text-base">Nudge (Premium)</button>
                  )}
                  {family.seniorPhone && (
                    <a href={telHref(family.seniorPhone)} className="flex-1 py-3.5 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-base flex items-center justify-center gap-2">
                      <Phone size={18} /> Call {seniorName}
                    </a>
                  )}
                </div>
                {nudgeWarning && <p className="text-[#6B645A] text-sm leading-relaxed px-1">{nudgeWarning}</p>}
              </div>
            )}

            {isOwner && family.others.filter(o => !o.is_senior).length === 0 && (
              <button onClick={() => navigate('/family-invite')} className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:opacity-80 text-left">
                <div className="w-12 h-12 rounded-xl bg-[#1B365D]/10 flex items-center justify-center flex-shrink-0">
                  <Users size={24} color="#1B365D" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Add the rest of the family</p>
                  <p className="text-gray-500 text-sm">Siblings and caregivers get the same check-in text.</p>
                </div>
                <ChevronRight size={18} color="#D1D5DB" />
              </button>
            )}
          </>
        )}

        {/* ══════════ ELDER VIEW ══════════ */}
        {isSenior && (
          <div className="flex flex-col gap-2">
            <button
              onClick={handleCheckIn}
              disabled={checkInStatus === 'loading' || alreadyCheckedIn}
              className={`w-full rounded-2xl py-7 flex flex-col items-center gap-2 shadow-md transition-colors ${isSent || alreadyCheckedIn ? 'bg-green-500' : 'bg-[#1B365D]'}`}
            >
              <div className="flex items-center gap-3">
                <CheckCircle size={32} color={isSent || alreadyCheckedIn ? 'white' : '#D4A843'} strokeWidth={isSent || alreadyCheckedIn ? 2.5 : 1.5} />
                <span className="text-white font-bold" style={{ fontSize: '22px' }}>
                  {isSent || alreadyCheckedIn ? '✓ Checked In' : "I'm Okay Today"}
                </span>
              </div>
              <span className="text-white/75" style={{ fontSize: '15px' }}>
                {alreadyCheckedIn ? "You've already checked in today. Check back tomorrow!" : isSent ? 'Your family has been notified' : "Tap to let your family know you're doing well"}
              </span>
            </button>
            <p className="text-center text-sm text-gray-400">
              {lastCheckIn ? `Last check-in: Today at ${fmtTime(lastCheckIn)}` : 'No check-in today yet'}
            </p>
            {alreadyCheckedIn && !premium && (
              <p className="text-center text-sm text-gray-400">
                ✓ Family can see this in the app.{' '}
                <button onClick={() => navigate('/upgrade')} className="text-[#D4A843] underline font-medium">Upgrade to also send them a text.</button>
              </p>
            )}
            {noteSaved && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <p className="text-green-700 text-sm font-semibold">✓ Note sent to your family!</p>
              </div>
            )}
            {showNoteInput && premium && (
              <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                <p className="text-[#1B365D] font-semibold text-sm">Add a note for your family (optional)</p>
                <input type="text" value={checkinNote} onChange={e => setCheckinNote(e.target.value)} placeholder="e.g. Going to the store" maxLength={200}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800" style={{ fontSize: '16px' }} />
                <div className="flex gap-2">
                  <button onClick={saveCheckinNote} disabled={!checkinNote.trim() || noteSaving} className="flex-1 py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-sm disabled:opacity-40">
                    {noteSaving ? 'Sending...' : 'Send Note'}
                  </button>
                  <button onClick={() => setShowNoteInput(false)} className="px-5 py-3 rounded-xl bg-gray-200 text-gray-600 font-semibold text-sm">Skip</button>
                </div>
              </div>
            )}
            {alreadyCheckedIn && premium && dailyQuote && (
              <div className="bg-[#F5E1E6]/40 border border-[#E7E2D8] rounded-2xl p-5 shadow-[0_2px_6px_rgba(45,42,36,0.06)]">
                <p className="text-[#D4A843] font-semibold text-center mb-3" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>
                  {dailyQuote.type === 'quote' ? 'DAILY INSPIRATION' : 'DAILY LAUGH'}
                </p>
                <p className="text-[#1B365D] leading-relaxed text-center" style={{ fontFamily: 'var(--font-display)', fontSize: '17px', fontStyle: 'italic' }}>&ldquo;{dailyQuote.content}&rdquo;</p>
                {dailyQuote.author && <p className="text-[#6B645A] text-sm italic text-right mt-2">{dailyQuote.author}</p>}
              </div>
            )}
            <button onClick={() => setHelpModal(true)} className="w-full rounded-2xl py-3 flex items-center justify-center gap-2 bg-[#B5483F] shadow-sm active:scale-[0.98] transition-all">
              <span className="text-white font-semibold" style={{ fontSize: '17px' }}>🆘 I Need Help</span>
            </button>
          </div>
        )}

        {isSenior && (
          premium ? (
            quickDialContacts.length > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 px-1">Speed Dial</p>
                <div className="grid grid-cols-2 gap-3">
                  {quickDialContacts.map(c => (
                    <a key={c.id} href={telHref(c.phone)} className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-sm active:opacity-80">
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
                <button onClick={() => navigate('/profile')} className="text-[#1B365D] text-sm font-semibold underline mt-1">Add contacts in Settings</button>
              </div>
            )
          ) : (
            <div className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Lock size={22} color="#9CA3AF" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <p className="text-[#1B365D] font-semibold text-sm">Speed Dial Contacts</p>
                <Link to="/upgrade" className="text-[#D4A843] text-xs font-semibold mt-1 inline-block">Upgrade to add speed dial contacts →</Link>
              </div>
            </div>
          )
        )}

        {/* ── Today at a glance (the senior's data, for everyone) ── */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 px-1">
            {isSenior ? 'Today at a glance' : `${seniorName || 'Their'}${seniorName ? "'s" : ''} day`}
          </p>
          <div className="flex flex-col gap-3">
            <button onClick={() => navigate('/medications')} className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:opacity-80">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Pill size={24} color="#2563EB" strokeWidth={1.5} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Medications</p>
                <p className="text-gray-500 text-sm">
                  {!seniorJoined ? 'Set up once they join' : medsDue > 0 ? `${medsDue} dose${medsDue !== 1 ? 's' : ''} remaining today` : 'Nothing due, or all doses taken'}
                </p>
              </div>
              <ChevronRight size={18} color="#D1D5DB" />
            </button>
            <button onClick={() => navigate('/appointments')} className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:opacity-80">
              <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                <Calendar size={24} color="#7C3AED" strokeWidth={1.5} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Appointments</p>
                <p className="text-gray-500 text-sm">{nextAppt ? `${nextAppt.title}, ${formatApptDate(nextAppt.appointment_date)}` : 'Nothing coming up'}</p>
              </div>
              <ChevronRight size={18} color="#D1D5DB" />
            </button>
            <button onClick={() => navigate('/family')} className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:opacity-80">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={24} color="#16A34A" strokeWidth={1.5} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Family Messages</p>
                <p className="text-gray-500 text-sm">{msgCount > 0 ? `${msgCount} message${msgCount !== 1 ? 's' : ''}` : 'No messages yet'}</p>
              </div>
              <ChevronRight size={18} color="#D1D5DB" />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-300 pb-1">Riggins Strategic Solutions • Ryan Riggins, Licensed NC Realtor</p>
        <p className="text-center text-xs text-gray-300 pb-2">
          <Link to="/terms" className="underline hover:text-gray-500">Terms of Service</Link>{' | '}<Link to="/privacy" className="underline hover:text-gray-500">Privacy Policy</Link>
        </p>
      </div>

      {showReviewPrompt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-xl text-center">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto"><Heart size={28} color="#D4A843" strokeWidth={1.5} /></div>
            <h2 className="text-[#1B365D] font-bold text-lg">Enjoying SeniorSafe?</h2>
            <p className="text-gray-500 text-sm leading-relaxed">A quick review helps other families find us.</p>
            <button
              onClick={async () => {
                setShowReviewPrompt(false)
                await supabase.from('user_profile').update({ review_prompted_date: new Date().toISOString(), review_prompt_count: (family.me.review_prompt_count || 0) + 1 }).eq('user_id', user.id)
                const { isIOS } = await import('../lib/platform')
                window.open(isIOS() ? 'https://apps.apple.com/app/seniorsafe/id6744250582?action=write-review' : 'https://apps.apple.com/app/seniorsafe/id6744250582', '_blank')
              }}
              className="w-full py-3.5 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-base"
            >Rate SeniorSafe</button>
            <button
              onClick={async () => {
                setShowReviewPrompt(false)
                await supabase.from('user_profile').update({ review_prompted_date: new Date().toISOString(), review_prompt_count: (family.me.review_prompt_count || 0) + 1 }).eq('user_id', user.id)
              }}
              className="text-gray-400 text-sm"
            >Not Now</button>
          </div>
        </div>
      )}

      {showTrialModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5 shadow-xl text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto"><Sparkles size={32} color="#D97706" strokeWidth={1.5} /></div>
            <h2 className="text-[#1B365D] font-bold text-xl">Your trial ends today</h2>
            <p className="text-gray-600 text-base leading-relaxed">
              Without a subscription, {seniorName ? `${seniorName}'s` : 'the'} check-ins stay in the app but you will no longer get a text when they check in, or an alert when they don't.
            </p>
            <ul className="text-gray-600 text-sm text-left space-y-2 px-2">
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> Missed check-in alert</li>
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> Check-in texts</li>
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> Medication reminders</li>
              <li className="flex items-center gap-2"><Lock size={14} color="#D4A843" /> Document Vault and AI</li>
            </ul>
            <button onClick={() => { setShowTrialModal(false); navigate('/upgrade') }} className="w-full py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-lg">Subscribe, $14.99/mo</button>
            <button onClick={() => setShowTrialModal(false)} className="text-gray-400 text-sm underline">Continue with Free</button>
          </div>
        </div>
      )}

      {helpModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5 shadow-xl">
            {helpFailed ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center"><AlertTriangle size={30} color="#DC2626" strokeWidth={2} /></div>
                <p className="text-red-700 font-bold text-lg">Text alert failed</p>
                <p className="text-gray-600 text-base leading-relaxed">Please call your family directly to let them know you need help.</p>
                <a href="tel:911" className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg text-center block">📞 Call 911</a>
                <button onClick={() => { setHelpFailed(false); setHelpModal(false) }} className="w-full py-4 rounded-xl bg-gray-200 text-gray-600 font-semibold text-base">Close</button>
              </div>
            ) : helpSent ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle size={48} color="#16A34A" strokeWidth={1.5} />
                <p className="text-green-700 font-bold text-lg">Your family has been alerted.</p>
                <p className="text-gray-500 text-base leading-relaxed">Do you also need emergency services?</p>
                <a href="tel:911" className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg text-center block">📞 Call 911</a>
                <button onClick={() => { setHelpSent(false); setHelpModal(false) }} className="w-full py-4 rounded-xl bg-gray-200 text-gray-600 font-semibold text-base">I don&apos;t need 911, go back home</button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center"><AlertTriangle size={30} color="#DC2626" strokeWidth={2} /></div>
                  <h2 className="text-[#1B365D] font-bold text-xl">Are you sure?</h2>
                  <p className="text-gray-500 text-base leading-relaxed">This will send an urgent alert to your entire family.</p>
                </div>
                <div className="flex flex-col gap-3">
                  <button onClick={sendHelpAlert} disabled={helpSending} className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg disabled:opacity-60">{helpSending ? 'Sending...' : 'Yes, Send Alert'}</button>
                  <button onClick={() => setHelpModal(false)} disabled={helpSending} className="w-full py-4 rounded-xl bg-gray-300 text-gray-700 font-semibold text-lg disabled:opacity-60">Cancel</button>
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
