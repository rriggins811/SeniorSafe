import { useState } from 'react'
import { Shield, CheckCircle, Phone, Settings, LogOut, Pill, MoreHorizontal, ChevronRight, MessageCircle } from 'lucide-react'
import HelpModal from './HelpModal'

function formatTelHref(phone) {
  if (!phone) return 'tel:'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
  return `tel:${digits}`
}

export default function ParentHome({
  displayName,
  alreadyCheckedIn,
  checkInStatus,
  lastCheckInLabel,
  onCheckIn,
  medsDue,
  onMeds,
  quickDialContacts = [],
  dailyQuote,
  showNoteInput,
  checkinNote,
  onCheckinNoteChange,
  onSaveNote,
  onSkipNote,
  noteSaving,
  noteSaved,
  isPremiumUser,
  helpModal,
  helpFailed,
  helpSent,
  helpSending,
  onOpenHelp,
  onSendHelp,
  onCloseHelp,
  onSettings,
  onSignOut,
  onAsk,
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const isSent = checkInStatus === 'sent'
  const checked = isSent || alreadyCheckedIn

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
      <header className="bg-[#1B365D] px-5 pt-10 pb-6">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Shield size={22} color="#D4A843" strokeWidth={1.5} />
            <div className="min-w-0">
              <p className="text-[#D4A843] font-semibold" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>
                SENIORSAFE
              </p>
              <h1
                className="text-white leading-tight truncate"
                style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700 }}
              >
                {displayName}
              </h1>
            </div>
          </div>
          <button
            onClick={() => setMoreOpen(true)}
            className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0"
            aria-label="More"
          >
            <MoreHorizontal size={20} color="rgba(255,255,255,0.85)" />
          </button>
        </div>
      </header>

      <main className="flex-1 px-5 py-6 max-w-lg mx-auto w-full flex flex-col">
        <div className="flex-1 flex flex-col justify-center gap-4">
          <button
            onClick={onCheckIn}
            disabled={checkInStatus === 'loading' || alreadyCheckedIn}
            className={`w-full rounded-[28px] py-10 px-5 flex flex-col items-center gap-3 shadow-md transition-colors ${
              checked ? 'bg-green-600' : 'bg-[#1B365D]'
            }`}
          >
            <CheckCircle
              size={56}
              color={checked ? 'white' : '#D4A843'}
              strokeWidth={checked ? 2.5 : 1.6}
            />
            <span className="text-white font-bold text-center" style={{ fontSize: '28px', lineHeight: 1.15 }}>
              {checked ? "You're checked in" : "I'm Okay Today"}
            </span>
            <span className="text-white/80 text-center" style={{ fontSize: '16px', lineHeight: 1.4 }}>
              {alreadyCheckedIn
                ? lastCheckInLabel || 'Your family knows you are doing well'
                : isSent
                ? 'Your family has been notified'
                : 'Tap once to let your family know you are doing well'}
            </span>
          </button>

          {lastCheckInLabel && !alreadyCheckedIn && (
            <p className="text-center text-sm text-[#6B645A]">{lastCheckInLabel}</p>
          )}

          {noteSaved && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-3 text-center">
              <p className="text-green-700 text-sm font-semibold">Note sent to your family</p>
            </div>
          )}

          {showNoteInput && isPremiumUser && (
            <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3">
              <p className="text-[#1B365D] font-semibold text-sm">Add a note for your family (optional)</p>
              <input
                type="text"
                value={checkinNote}
                onChange={(e) => onCheckinNoteChange(e.target.value)}
                placeholder="e.g. Going to the store"
                maxLength={200}
                className="w-full px-4 py-3 border-2 border-[#E7E2D8] rounded-xl focus:outline-none focus:border-[#1B365D] text-[#2D2A24]"
                style={{ fontSize: '16px' }}
              />
              <div className="flex gap-2">
                <button
                  onClick={onSaveNote}
                  disabled={!checkinNote.trim() || noteSaving}
                  className="flex-1 py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-sm disabled:opacity-40"
                >
                  {noteSaving ? 'Sending...' : 'Send Note'}
                </button>
                <button
                  onClick={onSkipNote}
                  className="px-5 py-3 rounded-xl bg-[#E7E2D8] text-[#6B645A] font-semibold text-sm"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {alreadyCheckedIn && isPremiumUser && dailyQuote && (
            <div className="bg-[#F5E1E6]/40 border border-[#E7E2D8] rounded-2xl p-5">
              <p className="text-[#D4A843] font-semibold text-center mb-3" style={{ fontSize: '11px', letterSpacing: '0.16em' }}>
                {dailyQuote.type === 'quote' ? 'DAILY INSPIRATION' : 'DAILY LAUGH'}
              </p>
              <p
                className="text-[#1B365D] leading-relaxed text-center"
                style={{ fontFamily: 'var(--font-display)', fontSize: '17px', fontStyle: 'italic' }}
              >
                &ldquo;{dailyQuote.content}&rdquo;
              </p>
              {dailyQuote.author && (
                <p className="text-[#6B645A] text-sm italic text-right mt-2">{dailyQuote.author}</p>
              )}
            </div>
          )}

          <button
            onClick={onOpenHelp}
            className="w-full rounded-[28px] py-5 flex items-center justify-center gap-3 bg-[#B5483F] shadow-sm active:scale-[0.99] transition-transform"
          >
            <Phone size={22} color="white" strokeWidth={2} />
            <span className="text-white font-bold" style={{ fontSize: '20px' }}>I Need Help</span>
          </button>

          <button
            onClick={onAsk}
            className="w-full rounded-[28px] py-5 px-5 flex items-center gap-4 bg-white border-2 border-[#1B365D] shadow-sm active:scale-[0.99] transition-transform"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#1B365D] flex items-center justify-center flex-shrink-0">
              <MessageCircle size={22} color="#D4A843" strokeWidth={1.8} />
            </div>
            <div className="text-left min-w-0">
              <p className="text-[#1B365D] font-bold" style={{ fontSize: '20px' }}>Ask a question</p>
              <p className="text-[#6B645A] text-sm">Recipes, weather, everyday help</p>
            </div>
          </button>

          {medsDue > 0 && (
            <button
              onClick={onMeds}
              className="w-full bg-white rounded-2xl px-4 py-4 flex items-center gap-3 shadow-sm"
            >
              <div className="w-11 h-11 rounded-xl bg-[#1B365D]/8 flex items-center justify-center">
                <Pill size={20} color="#1B365D" strokeWidth={1.7} />
              </div>
              <p className="text-[#1B365D] font-semibold text-left flex-1" style={{ fontSize: '16px' }}>
                {medsDue} dose{medsDue === 1 ? '' : 's'} left today
              </p>
              <ChevronRight size={18} color="#C4BDB3" />
            </button>
          )}

          {quickDialContacts.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D4A843] mb-3 px-1">
                Call
              </p>
              <div className="grid grid-cols-2 gap-3">
                {quickDialContacts.map((c) => (
                  <a
                    key={c.id}
                    href={formatTelHref(c.phone)}
                    className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-sm"
                  >
                    <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
                      <Phone size={18} color="#16A34A" strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[#1B365D] font-bold text-sm truncate">{c.label}</p>
                      <p className="text-[#6B645A] text-xs truncate">{c.name}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {moreOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setMoreOpen(false)} />
          <div className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-3xl px-5 pt-4 pb-8 max-w-lg mx-auto">
            <div className="w-10 h-1 rounded-full bg-[#E7E2D8] mx-auto mb-4" />
            <button
              onClick={() => { setMoreOpen(false); onSettings() }}
              className="w-full flex items-center gap-3 py-4 text-[#1B365D] font-semibold text-lg"
            >
              <Settings size={20} /> Settings
            </button>
            <button
              onClick={() => { setMoreOpen(false); onSignOut() }}
              className="w-full flex items-center gap-3 py-4 text-[#6B645A] font-semibold text-lg"
            >
              <LogOut size={20} /> Sign out
            </button>
            <a
              href="tel:911"
              className="w-full flex items-center gap-3 py-4 text-[#B5483F] font-bold text-lg"
            >
              <Phone size={20} /> Call 911
            </a>
          </div>
        </>
      )}

      <HelpModal
        open={helpModal}
        helpFailed={helpFailed}
        helpSent={helpSent}
        helpSending={helpSending}
        onSend={onSendHelp}
        onClose={onCloseHelp}
      />
    </div>
  )
}
