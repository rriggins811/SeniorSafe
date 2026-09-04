import {
  Shield, CheckCircle, AlertTriangle, Clock, Pill, Calendar, MessageCircle,
  ChevronRight, Phone, Heart, FolderLock, Settings, Sparkles, Home, Users, MessageSquare, Copy,
} from 'lucide-react'
import BottomNav from '../BottomNav'
import { isPremium } from '../../lib/subscription'

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
  onCopyInvite,
  copied = false,
  alertLabel,
  late: lateProp,
  adminCheckIn,
  adminCheckInLoaded,
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
  smsToast,
  onDismissToast,
  preview = false,
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

  let status = {
    tone: 'wait',
    icon: Clock,
    title: `Waiting on ${name}`,
    body: alertLabel ? `Their check-in time is ${alertLabel}.` : 'No check-in yet this morning.',
    wrap: 'bg-[#FAF8F4] border-[#D4A843]',
    iconColor: '#D4A843',
    titleClass: 'text-[#1B365D]',
    bodyClass: 'text-[#6B645A]',
  }
  if (!seniorJoined && !preview) {
    status = {
      tone: 'join',
      icon: Clock,
      title: `Waiting for ${name} to join`,
      body: `${name} needs SeniorSafe on their phone. Once they open the link, their check-ins show up here.`,
      wrap: 'bg-white border-[#D4A843]',
      iconColor: '#8A6A1E',
      titleClass: 'text-[#1B365D]',
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
      titleClass: 'text-[#1B365D]',
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
      <header className="bg-[#1B365D] px-5 pt-10 pb-6">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Shield size={22} color="#D4A843" strokeWidth={1.5} />
            <div className="min-w-0">
              <p className="text-[#D4A843] font-semibold" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>
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

        {trialDays !== null && trialDays !== undefined && trialDays <= 4 && trialDays > 0 && !trialBannerDismissed && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <Sparkles size={20} color="#D97706" className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-800 font-semibold text-base">
                {trialDays === 1 ? 'Your free trial ends tomorrow' : `Your free trial ends in ${trialDays} days`}
              </p>
              <p className="text-amber-700 text-base mt-0.5 leading-relaxed">
                After that, the missed check-in alert and check-in texts stop. Subscribe to keep them.
              </p>
              <button
                onClick={() => onNavigate('/upgrade')}
                className="mt-2 px-4 py-2 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-base"
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

        <section className={`rounded-3xl border-2 p-5 ${status.wrap}`}>
          <div className="flex items-start gap-3">
            <StatusIcon size={28} color={status.iconColor} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className={`font-bold ${status.titleClass}`} style={{ fontSize: '22px', fontFamily: 'var(--font-display)' }}>
                {status.title}
              </p>
              <p className={`${status.bodyClass} text-base mt-1 leading-relaxed`}>{status.body}</p>
              {adminCheckIn?.note && (
                <p className="text-[#1B365D] text-base mt-2 italic">&ldquo;{adminCheckIn.note}&rdquo;</p>
              )}
            </div>
          </div>

          {status.tone === 'join' && isOwner && (
            <div className="mt-4 flex flex-col gap-2">
              {inviteSmsHref && (
                <a href={inviteSmsHref} className="w-full py-3.5 rounded-xl bg-[#1B365D] text-[#D4A843] font-bold text-base flex items-center justify-center gap-2">
                  <MessageSquare size={18} /> Text {name} the link again
                </a>
              )}
              <button onClick={onCopyInvite} className="w-full py-3.5 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-base flex items-center justify-center gap-2">
                {copied ? <><CheckCircle size={18} /> Copied</> : <><Copy size={18} /> Copy the link</>}
              </button>
            </div>
          )}

          {seniorJoined && !checkedIn && adminCheckInLoaded && (
            <div className="mt-4 flex flex-col gap-2">
              {premium ? (
                nudgeCount >= 2 ? (
                  <p className="text-base leading-relaxed text-[#7A2E28]">
                    Two nudges already sent today. If you are worried, call {name} or someone nearby.
                  </p>
                ) : (
                  <>
                    <button
                      onClick={onNudge}
                      disabled={reminding}
                      className="w-full py-3.5 rounded-xl bg-[#D4A843] text-[#1B365D] font-bold text-base disabled:opacity-60"
                    >
                      {reminding ? 'Sending…' : 'Send a nudge'}
                    </button>
                    {nudgeWarning && (
                      <p className="text-sm mt-1 leading-relaxed text-[#6B645A]">{nudgeWarning}</p>
                    )}
                  </>
                )
              ) : (
                <button
                  onClick={() => onNavigate('/upgrade')}
                  className="w-full py-3 rounded-xl bg-white border border-[#E7E2D8] text-[#1B365D] font-semibold text-base"
                >
                  Nudge is a Premium feature
                </button>
              )}
              {callHref && (
                <a
                  href={callHref}
                  className="w-full py-3.5 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-base flex items-center justify-center gap-2"
                >
                  <Phone size={18} /> Call {name}
                </a>
              )}
            </div>
          )}
        </section>

        {showAddFamily && (
          <button
            onClick={() => onNavigate('/family-invite')}
            className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-[#1B365D]/8 flex items-center justify-center flex-shrink-0">
              <Users size={22} color="#1B365D" strokeWidth={1.6} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Add the rest of the family</p>
              <p className="text-[#6B645A] text-sm">Siblings and caregivers get the same check-in text.</p>
            </div>
            <ChevronRight size={18} color="#C4BDB3" />
          </button>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D4A843] mb-3 px-1">
            {seniorName ? `${seniorName}'s day` : 'Today'}
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onNavigate('/medications')}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1B365D]/8 flex items-center justify-center flex-shrink-0">
                <Pill size={22} color="#1B365D" strokeWidth={1.6} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Medications</p>
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
              onClick={() => onNavigate('/appointments')}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1B365D]/8 flex items-center justify-center flex-shrink-0">
                <Calendar size={22} color="#1B365D" strokeWidth={1.6} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Next appointment</p>
                <p className="text-[#6B645A] text-sm truncate">
                  {nextAppt
                    ? `${nextAppt.title}, ${formatApptDate(nextAppt.appointment_date)}${nextAppt.appointment_time ? ` ${formatApptTime(nextAppt.appointment_time)}` : ''}`
                    : 'Nothing upcoming'}
                </p>
              </div>
              <ChevronRight size={18} color="#C4BDB3" />
            </button>

            <button
              onClick={() => onNavigate('/family')}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm"
            >
              <div className="w-12 h-12 rounded-xl bg-[#1B365D]/8 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={22} color="#1B365D" strokeWidth={1.6} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#1B365D] font-semibold" style={{ fontSize: '16px' }}>Family</p>
                <p className="text-[#6B645A] text-sm">
                  {unreadMsgCount > 0
                    ? `${unreadMsgCount} new message${unreadMsgCount === 1 ? '' : 's'}`
                    : 'No new messages'}
                </p>
              </div>
              <ChevronRight size={18} color="#C4BDB3" />
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D4A843] mb-3 px-1">If you need it</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => onNavigate('/vault')}
              className="bg-white rounded-2xl p-4 flex flex-col gap-2 shadow-sm text-left"
            >
              <FolderLock size={20} color="#1B365D" strokeWidth={1.6} />
              <span className="text-[#1B365D] font-semibold text-sm">Vault</span>
            </button>
            <button
              onClick={() => onNavigate('/emergency')}
              className="bg-white rounded-2xl p-4 flex flex-col gap-2 shadow-sm text-left"
            >
              <Heart size={20} color="#B5483F" strokeWidth={1.6} />
              <span className="text-[#1B365D] font-semibold text-sm">ER card</span>
            </button>
            <button
              onClick={() => onNavigate('/maggie')}
              className="bg-white rounded-2xl p-4 flex flex-col gap-2 shadow-sm text-left"
            >
              <Sparkles size={20} color="#D4A843" strokeWidth={1.6} />
              <span className="text-[#1B365D] font-semibold text-sm">Maggie</span>
            </button>
          </div>
        </div>

        {callHref && (checkedIn || !seniorJoined) && (
          <a
            href={callHref}
            className="w-full rounded-2xl py-4 bg-[#1B365D] text-white font-semibold text-center flex items-center justify-center gap-2"
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
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[60px] ${tab.on ? 'text-[#1B365D]' : 'text-[#6B645A]'}`}
              >
                <span className={`block w-1 h-1 rounded-full ${tab.on ? 'bg-[#D4A843]' : 'bg-transparent'}`} />
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
