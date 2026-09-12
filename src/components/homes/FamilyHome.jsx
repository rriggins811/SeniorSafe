import {
  CheckCircle, AlertTriangle, Clock, Pill, Calendar, MessageCircle,
  ChevronRight, Phone, Heart, FolderLock, Settings, Sparkles, Home, Users, MessageSquare, Copy, Bell,
} from 'lucide-react'
import BottomNav from '../BottomNav'
import { isPremium, MONTHLY_PRICE } from '../../lib/subscription'
import { Lock } from 'lucide-react'
import { logFunnel } from '../../lib/funnel'
import HammockMark from '../HammockMark'

// The adult child's morning board. One question first: is Mom okay today.
// Everything else sits below it.

function formatApptDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function formatApptTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatCheckInTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatTelHref(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
  return `tel:${digits}`
}

export default function FamilyHome({
  displayName,
  seniorName,
  seniorJoined = true,
  isOwner = false,
  inviteSmsHref,
  onSendInvite,
  inviteSending = false,
  inviteSentTo = '',
  inviteError = '',
  onCopyInvite,
  copied = false,
  alertLabel,
  late: lateProp,
  adminCheckIn,
  adminCheckInLoaded,
  history = [],
  medsDue = 0,
  medsTotal = 0,
  nextAppt,
  unreadMsgCount = 0,
  seniorPhone,
  subscriptionTier = 'free',
  reminding,
  nudgeCount = 0,
  nudgeWarning,
  onNudge,
  showAddFamily = false,
  onNavigate,
  redirectMessage,
  onDismissRedirect,
  failedNotification,
  onOpenFailedNotification,
  onDismissFailedNotification,
  trialDays,
  trialBannerDismissed,
  onDismissTrial,
  planEnded = false,
  contactName = '',
  smsToast,
  onDismissToast,
  preview = false,
  partner = null,
  webPushPrompt = false,
  webPushWorking = false,
  webPushError = '',
  onEnableWebPush,
  onDismissWebPush,
}) {
  const name = seniorName || 'Your loved one'
  const hour = new Date().getHours()
  const checkedIn = Boolean(adminCheckIn)
  const late = preview
    ? !checkedIn
    : adminCheckInLoaded && !checkedIn && (typeof lateProp === 'boolean' ? lateProp : hour >= 10)
  const premium = isPremium(subscriptionTier)
  const taken = Math.max(0, (medsTotal || 0) - (medsDue || 0))
  const checkInTime = formatCheckInTime(adminCheckIn?.checked_in_at)
  const callHref = formatTelHref(seniorPhone)

  // History strip: only days since the senior joined count, and today only
  // counts once it is decided (checked in, or past the alert time).
  const pastDays = history.filter(h => h.joined && !h.isToday)
  const missedDays = pastDays.filter(h => !h.checked).length
  const historySummary = pastDays.length === 0
    ? `${name} joined today. The strip fills in from tomorrow.`
    : missedDays === 0
    ? `Checked in every day for the last ${pastDays.length} day${pastDays.length === 1 ? '' : 's'}.`
    : `Missed ${missedDays} of the last ${pastDays.length} day${pastDays.length === 1 ? '' : 's'}.`

  let status = {
    tone: 'wait',
    icon: Clock,
    title: `Waiting on ${name}`,
    body: alertLabel ? `Their check-in time is ${alertLabel}.` : 'No check-in yet this morning.',
    wrap: 'bg-[#FAF8F4] border-[#F2B544]',
    iconColor: '#F2B544',
    titleClass: 'text-[#1F5A4B]',
    bodyClass: 'text-[#6B645A]',
  }
  if (!seniorJoined && !preview) {
    status = {
      tone: 'join',
      icon: Clock,
      title: `Waiting for ${name} to join`,
      body: `${name} needs Hammock365 on their phone. Once they open the link, their check-ins show up here.`,
      wrap: 'bg-white border-[#F2B544]',
      iconColor: '#8A6A1E',
      titleClass: 'text-[#1F5A4B]',
      bodyClass: 'text-[#6B645A]',
    }
  } else if (!adminCheckInLoaded) {
    status = {
      tone: 'load',
      icon: Clock,
      title: 'Checking today…',
      body: 'One moment.',
      wrap: 'bg-white border-[#E7E2D8]',
      iconColor: '#6B645A',
      titleClass: 'text-[#1F5A4B]',
      bodyClass: 'text-[#6B645A]',
    }
  } else if (checkedIn) {
    status = {
      tone: 'ok',
      icon: CheckCircle,
      title: `${name} is okay`,
      body: checkInTime ? `Checked in at ${checkInTime}` : 'Checked in today',
      wrap: 'bg-green-50 border-green-300',
      iconColor: '#16A34A',
      titleClass: 'text-green-900',
      bodyClass: 'text-green-800',
    }
  } else if (late) {
    status = {
      tone: 'late',
      icon: AlertTriangle,
      title: `No check-in from ${name} yet`,
      body: alertLabel ? `It's past their ${alertLabel} check-in time.` : `${name} has not tapped I'm Okay.`,
      wrap: 'bg-[#FDF2F0] border-[#B5483F]/40',
      iconColor: '#B5483F',
      titleClass: 'text-[#7A2E28]',
      bodyClass: 'text-[#7A2E28]',
    }
  }

  const StatusIcon = status.icon

  return (
    <div className="min-h-screen bg-[#FAF8F4] pb-24">
      <header className="bg-[#1F5A4B] px-5 pt-10 pb-6">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <HammockMark size={22} />
            <div className="min-w-0">
              <p className="text-[#F2B544] font-semibold" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>
                TODAY
              </p>
              <h1
                className="text-white leading-tight truncate"
                style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700 }}
              >
                {displayName}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isOwner && (
              <button
                onClick={() => onNavigate('/family-invite')}
                className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center"
                aria-label="Family and invites"
              >
                <Users size={18} color="white" strokeWidth={1.5} />
              </button>
            )}
            <button
              onClick={() => onNavigate('/emergency')}
              className="w-11 h-11 rounded-xl bg-red-500/20 flex items-center justify-center"
              aria-label="Emergency card"
            >
              <Heart size={18} color="#EF4444" strokeWidth={0} fill="#EF4444" />
            </button>
            <button
              onClick={() => onNavigate('/profile')}
              className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center"
              aria-label="Settings"
            >
              <Settings size={18} color="white" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 pt-5 pb-4 max-w-lg mx-auto flex flex-col gap-4">
        {redirectMessage && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={20} color="#2563EB" className="flex-shrink-0 mt-0.5" />
            <p className="text-blue-800 text-base flex-1 leading-relaxed">{redirectMessage}</p>
            <button onClick={onDismissRedirect} aria-label="Dismiss" className="text-blue-400 text-lg leading-none px-1">
              &times;
            </button>
          </div>
        )}

        {failedNotification && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <button type="button" className="flex-1 text-left" onClick={onOpenFailedNotification}>
              <p className="text-orange-800 font-semibold text-base">A notification did not go through</p>
              <p className="text-orange-700 text-base mt-0.5 leading-relaxed">
                Check that everyone in the family has a phone number.
              </p>
            </button>
            <button onClick={onDismissFailedNotification} aria-label="Dismiss" className="text-orange-400 text-lg leading-none px-1">
              &times;
            </button>
          </div>
        )}

        {planEnded && (
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={20} color="#B5483F" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-800 font-semibold text-base">Your paid plan has ended</p>
              <p className="text-red-700 text-base mt-0.5 leading-relaxed">
                {isOwner
                  ? `You are on the free plan now: the check-in still works and ${contactName || 'one contact'} gets a text if ${name} misses it. Texts to everyone, the vault, chat, and appointments are locked.`
                  : `The family is on the free plan now. Ask the person who set up the family to turn the paid plan back on.`}
              </p>
              {isOwner && (
                <button
                  onClick={() => onNavigate('/upgrade')}
                  className="mt-2 px-4 py-2 rounded-xl bg-[#1F5A4B] text-[#F2B544] font-semibold text-base"
                >
                  Turn it back on
                </button>
              )}
            </div>
          </div>
        )}

        {trialDays !== null && trialDays !== undefined && trialDays <= 4 && trialDays > 0 && !trialBannerDismissed && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <Sparkles size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-800 font-semibold text-base">
                {trialDays === 1 ? 'Your free trial ends tomorrow' : `Your free trial ends in ${trialDays} days`}
              </p>
              <p className="text-amber-700 text-base mt-0.5 leading-relaxed">
                After that, the texts to everyone and the family features stop; one contact still gets the missed check-in text. Subscribe to keep the rest.
              </p>
              <button
                onClick={() => onNavigate('/upgrade')}
                className="mt-2 px-4 py-2 rounded-xl bg-[#F2B544] text-[#2D2A24] font-semibold text-base"
              >
                Subscribe
              </button>
            </div>
            <button onClick={onDismissTrial} className="text-amber-400 text-lg leading-none" aria-label="Dismiss">&times;</button>
          </div>
        )}

        {smsToast && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center gap-3">
            <p className="text-blue-800 text-base flex-1">{smsToast}</p>
            <button onClick={onDismissToast} className="text-blue-400" aria-label="Dismiss">&times;</button>
          </div>
        )}

        {/* Web push opt-in (2026-09-12): the browser version's answer to the
            store apps' "just checked in" notification, free, no text needed.
            Browsers only show the permission prompt from a tap, so a button. */}
        {webPushPrompt && (
          <div className="bg-white border-2 border-[#F2B544] rounded-2xl p-4 flex items-start gap-3">
            <Bell size={20} color="#8A6A1E" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[#1F5A4B] font-semibold text-base">Get a notification when {name} checks in</p>
              <p className="text-[#6B645A] text-base mt-0.5 leading-relaxed">
                Free, right here in this browser. Your phone or computer will ask once.
              </p>
              <button
                onClick={onEnableWebPush}
                disabled={webPushWorking}
                className="mt-2 px-4 py-2 rounded-xl bg-[#1F5A4B] text-white font-semibold text-base disabled:opacity-60"
              >
                {webPushWorking ? 'One moment...' : 'Turn on notifications'}
              </button>
              {webPushError && <p className="text-[#7A2E28] text-sm mt-2">{webPushError}</p>}
            </div>
            <button onClick={onDismissWebPush} className="text-[#6B645A] text-lg leading-none" aria-label="Not now">&times;</button>
          </div>
        )}

        <section className={`rounded-3xl border-2 p-5 ${status.wrap}`}>
          <div className="flex items-start gap-3">
            <StatusIcon size={28} color={status.iconColor} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className={`font-bold ${status.titleClass}`} style={{ fontSize: '22px', fontFamily: 'var(--font-display)' }}>
                {status.title}
              </p>
              <p className={`${status.bodyClass} text-base mt-1 leading-relaxed`}>{status.body}</p>
              {adminCheckIn?.note && (
                <p className="text-[#1F5A4B] text-base mt-2 italic">&ldquo;{adminCheckIn.note}&rdquo;</p>
              )}
            </div>
          </div>

          {status.tone === 'join' && isOwner && (
            <div className="mt-4 flex flex-col gap-2">
              {inviteSmsHref && onSendInvite && (
                <button
                  onClick={onSendInvite}
                  disabled={inviteSending}
                  className="w-full py-3.5 rounded-xl bg-[#1F5A4B] text-[#F2B544] font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <MessageSquare size={18} /> {inviteSending ? 'Sending…' : `Text ${name} the link again`}
                </button>
              )}
              {inviteSentTo && (
                <p className="text-green-800 font-semibold text-center flex items-center justify-center gap-2 text-base">
                  <CheckCircle size={18} /> Sent to {inviteSentTo}
                </p>
              )}
              {inviteError && (
                <div className="bg-[#FDF2F0] border border-[#B5483F]/40 rounded-xl p-3 flex flex-col gap-1">
                  <p className="text-[#7A2E28] text-base">{inviteError}</p>
                  {inviteSmsHref && (
                    <a href={inviteSmsHref} className="text-[#1F5A4B] font-semibold underline underline-offset-2 text-base">
                      Text it from this phone instead
                    </a>
                  )}
                </div>
              )}
              <button onClick={onCopyInvite} className="w-full py-3.5 rounded-xl border-2 border-[#1F5A4B] text-[#1F5A4B] font-semibold text-base flex items-center justify-center gap-2">
                {copied ? <><CheckCircle size={18} /> Copied</> : <><Copy size={18} /> Copy the link</>}
              </button>
            </div>
          )}

          {seniorJoined && !checkedIn && adminCheckInLoaded && (
            <div className="mt-4 flex flex-col gap-2">
              {nudgeCount >= 2 ? (
                  <p className="text-base leading-relaxed text-[#7A2E28]">
                    Two nudges already sent today. If you are worried, call {name} or someone nearby.
                  </p>
                ) : (
                  <>
                    <button
                      onClick={onNudge}
                      disabled={reminding}
                      className="w-full py-3.5 rounded-xl bg-[#F2B544] text-[#2D2A24] font-bold text-base disabled:opacity-60"
                    >
                      {reminding ? 'Sending…' : 'Send a nudge'}
                    </button>
                    {nudgeWarning && (
                      <p className="text-sm mt-1 leading-relaxed text-[#6B645A]">{nudgeWarning}</p>
                    )}
                  </>
                )}
              {callHref && (
                <a
                  href={callHref}
                  className="w-full py-3.5 rounded-xl border-2 border-[#1F5A4B] text-[#1F5A4B] font-semibold text-base flex items-center justify-center gap-2"
                >
                  <Phone size={18} /> Call {name}
                </a>
              )}
            </div>
          )}
        </section>

        {/* Partner co-branding, Level 1: "Shared by" with the partner's logo,
            tagline and a call button. Sits under the status card so it never
            pushes the check-in below the fold. Renders only when the family
            carries a valid, active partner code. */}
        {partner && (
          <section className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
            {partner.logo_url && (
              <img
                src={partner.logo_url}
                alt=""
                className="w-14 h-14 rounded-xl object-contain bg-[#F3EFE7] flex-shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[#6B645A] font-semibold" style={{ fontSize: '11px', letterSpacing: '0.14em' }}>
                SHARED BY
              </p>
              <p className="text-[#1F5A4B] font-bold leading-tight" style={{ fontSize: '17px' }}>{partner.name}</p>
              {partner.tagline && (
                <p className="text-[#6B645A] text-sm truncate">{partner.tagline}</p>
              )}
            </div>
            {partner.phone && (
              <a
                href={formatTelHref(partner.phone)}
                aria-label={`Call ${partner.name}`}
                className="flex-shrink-0 px-3.5 py-2.5 rounded-xl bg-[#1F5A4B] text-white font-semibold text-sm flex items-center gap-1.5"
              >
                <Phone size={16} strokeWidth={2} /> Call
              </a>
            )}
          </section>
        )}

        {seniorJoined && history.length > 0 && (
          <section className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#F2B544] mb-3">Last 14 days</p>
            <div className="grid grid-cols-14 gap-1" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
              {history.map(h => {
                const decidedToday = h.isToday && (h.checked || late)
                const state = !h.joined ? 'blank'
                  : h.checked ? 'ok'
                  : h.isToday && !decidedToday ? 'pending'
                  : 'missed'
                const dot = state === 'ok' ? 'bg-green-500'
                  : state === 'missed' ? 'bg-[#B5483F]/70'
                  : state === 'pending' ? 'border-2 border-[#F2B544] bg-white'
                  : 'border border-dashed border-[#E7E2D8] bg-transparent'
                const title = state === 'ok' ? 'Checked in' : state === 'missed' ? 'No check-in' : state === 'pending' ? 'Today, not yet' : 'Before they joined'
                return (
                  <div key={h.key} className="flex flex-col items-center gap-1" title={title} aria-label={`${h.label} ${h.dayNum}: ${title}`}>
                    <span className={`w-full aspect-square max-w-[22px] rounded-full ${dot} ${h.isToday ? 'ring-2 ring-offset-1 ring-[#1F5A4B]/30' : ''}`} />
                    <span className="text-[10px] text-[#6B645A] leading-none">{h.label}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-[#6B645A] text-sm mt-3">{historySummary}</p>
          </section>
        )}

        {showAddFamily && (
          <button
            onClick={() => onNavigate('/family-invite')}
            className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-[#1F5A4B]/8 flex items-center justify-center flex-shrink-0">
              <Users size={22} color="#1F5A4B" strokeWidth={1.6} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[#1F5A4B] font-semibold" style={{ fontSize: '16px' }}>Add the rest of the family</p>
              <p className="text-[#6B645A] text-sm">{premium ? 'Siblings and caregivers get the same check-in text.' : 'Siblings and caregivers join free and see the board. Texts to everyone is on the paid plan.'}</p>
            </div>
            <ChevronRight size={18} color="#C4BDB3" />
          </button>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#F2B544] mb-3 px-1">
            {seniorName ? `${seniorName}'s day` : 'Today'}
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onNavigate('/medications')}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1F5A4B]/8 flex items-center justify-center flex-shrink-0">
                <Pill size={22} color="#1F5A4B" strokeWidth={1.6} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#1F5A4B] font-semibold" style={{ fontSize: '16px' }}>Medications</p>
                <p className="text-[#6B645A] text-sm">
                  {!seniorJoined
                    ? 'Set up once they join'
                    : medsTotal > 0
                    ? `${taken} of ${medsTotal} dose${medsTotal === 1 ? '' : 's'} taken`
                    : 'No medications on the list'}
                </p>
              </div>
              <ChevronRight size={18} color="#C4BDB3" />
            </button>

            <button
              onClick={() => { if (!premium) logFunnel('lock_tap', 'appointments'); onNavigate(premium ? '/appointments' : '/upgrade?feature=appointments') }}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1F5A4B]/8 flex items-center justify-center flex-shrink-0">
                <Calendar size={22} color="#1F5A4B" strokeWidth={1.6} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#1F5A4B] font-semibold" style={{ fontSize: '16px' }}>Next appointment</p>
                <p className="text-[#6B645A] text-sm truncate">
                  {!premium
                    ? `Paid plan, ${MONTHLY_PRICE} a month`
                    : nextAppt
                    ? `${nextAppt.title}, ${formatApptDate(nextAppt.appointment_date)}${nextAppt.appointment_time ? ` ${formatApptTime(nextAppt.appointment_time)}` : ''}`
                    : 'Nothing upcoming'}
                </p>
              </div>
              {premium ? <ChevronRight size={18} color="#C4BDB3" /> : <Lock size={18} color="#F2B544" />}
            </button>

            <button
              onClick={() => { if (!premium) logFunnel('lock_tap', 'chat'); onNavigate(premium ? '/family' : '/upgrade?feature=chat') }}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1F5A4B]/8 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={22} color="#1F5A4B" strokeWidth={1.6} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#1F5A4B] font-semibold" style={{ fontSize: '16px' }}>Family</p>
                <p className="text-[#6B645A] text-sm">
                  {!premium
                    ? `Chat and photos, paid plan, ${MONTHLY_PRICE} a month`
                    : unreadMsgCount > 0
                    ? `${unreadMsgCount} new message${unreadMsgCount === 1 ? '' : 's'}`
                    : 'No new messages'}
                </p>
              </div>
              <ChevronRight size={18} color="#C4BDB3" />
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#F2B544] mb-3 px-1">If you need it</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => onNavigate('/vault')}
              className="bg-white rounded-2xl p-4 flex flex-col gap-2 shadow-sm text-left"
            >
              <FolderLock size={20} color="#1F5A4B" strokeWidth={1.6} />
              <span className="text-[#1F5A4B] font-semibold text-sm">Vault</span>
            </button>
            <button
              onClick={() => onNavigate('/emergency')}
              className="bg-white rounded-2xl p-4 flex flex-col gap-2 shadow-sm text-left"
            >
              <Heart size={20} color="#B5483F" strokeWidth={1.6} />
              <span className="text-[#1F5A4B] font-semibold text-sm">ER card</span>
            </button>
            <button
              onClick={() => onNavigate('/maggie')}
              className="bg-white rounded-2xl p-4 flex flex-col gap-2 shadow-sm text-left"
            >
              <Sparkles size={20} color="#F2B544" strokeWidth={1.6} />
              <span className="text-[#1F5A4B] font-semibold text-sm">Maggie</span>
            </button>
          </div>
        </div>

        {callHref && (checkedIn || !seniorJoined) && (
          <a
            href={callHref}
            className="w-full rounded-2xl py-4 bg-[#1F5A4B] text-white font-semibold text-center flex items-center justify-center gap-2"
          >
            <Phone size={18} /> Call {name}
          </a>
        )}
      </div>

      {preview ? (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#FAF8F4] border-t border-[#E7E2D8]">
          <div className="flex max-w-lg mx-auto">
            {[
              { label: 'Home', Icon: Home, on: true },
              { label: 'Vault', Icon: FolderLock, on: false },
              { label: 'Family', Icon: Users, on: false },
              { label: 'Maggie', Icon: Sparkles, on: false },
            ].map((tab) => (
              <div
                key={tab.label}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[60px] ${tab.on ? 'text-[#1F5A4B]' : 'text-[#6B645A]'}`}
              >
                <span className={`block w-1 h-1 rounded-full ${tab.on ? 'bg-[#F2B544]' : 'bg-transparent'}`} />
                <tab.Icon size={22} strokeWidth={tab.on ? 2.5 : 1.5} />
                <span className="text-xs font-medium">{tab.label}</span>
              </div>
            ))}
          </div>
        </nav>
      ) : (
        <BottomNav />
      )}
    </div>
  )
}
