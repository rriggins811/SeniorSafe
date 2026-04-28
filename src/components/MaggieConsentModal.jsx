import { useState } from 'react'
import { Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AIMark from './AIMark'

// First-time consent modal for Premium+ subscribers, shown once before
// Maggie's first message. Captures explicit consent for AI disclosure,
// conversation storage, family-context memory, and the alert layer.
//
// Acute safety alerts default ON (falls, wandering, suicide, hazards).
// Chronic pattern alerts default OFF and require opt-in (mood, isolation,
// cognition, general concerning content). HIPAA-honest design.
//
// The "rename Maggie" toggle is shown but DISABLED ("coming soon"). It
// ships in Phase 2.
export default function MaggieConsentModal({ userId, onConsented }) {
  const [storageOk, setStorageOk] = useState(true)
  const [contextOk, setContextOk] = useState(true)
  const [acuteOn, setAcuteOn] = useState(true)
  const [moodOn, setMoodOn] = useState(false)
  const [isolationOn, setIsolationOn] = useState(false)
  const [cognitiveOn, setCognitiveOn] = useState(false)
  const [generalOn, setGeneralOn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canProceed = storageOk && contextOk

  async function handleAccept() {
    if (!canProceed) {
      setError('Conversation storage and family context are required to use Maggie.')
      return
    }
    setSaving(true)
    setError('')
    const { error: dbError } = await supabase
      .from('maggie_consent')
      .upsert({
        user_id: userId,
        ai_disclosure_acked: true,
        conversation_storage_consent: storageOk,
        family_context_consent: contextOk,
        acute_alerts_enabled: acuteOn,
        alerts_mood_optin: moodOn,
        alerts_isolation_optin: isolationOn,
        alerts_cognitive_optin: cognitiveOn,
        alerts_general_optin: generalOn,
        consented_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    setSaving(false)
    if (dbError) {
      setError('Could not save consent. ' + dbError.message)
      return
    }
    onConsented()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl p-6 max-h-[92vh] overflow-y-auto shadow-[0_-8px_24px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col items-center gap-3 mb-4">
          <AIMark size={56} />
          <h2 className="text-[#1B365D] text-center" style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700 }}>
            Meet Maggie
          </h2>
          <p className="text-[#6B645A] italic text-center" style={{ fontSize: '15px' }}>
            Your transition specialist
          </p>
        </div>

        <p className="text-[#2D2A24] mb-4" style={{ fontSize: '15px', lineHeight: 1.55 }}>
          Quick read before we start. Maggie is an AI assistant Ryan built. She is not licensed (not an attorney, advisor, agent, or clinician). For decisions that need a license, run them by a pro in your state. Now, your settings:
        </p>

        <Section title="Conversation storage (required)">
          <Toggle
            checked={storageOk}
            onChange={setStorageOk}
            label="Save my conversations so we can pick up where we left off"
            sub="Stored 24 months, then auto-deleted. You can wipe them anytime in Settings."
          />
        </Section>

        <Section title="Family context memory (required)">
          <Toggle
            checked={contextOk}
            onChange={setContextOk}
            label="Let Maggie keep a running summary of our family situation"
            sub="No specific medical details, medication names, or mental-health specifics are kept. HIPAA-honest design."
          />
        </Section>

        <Section title="Safety alert layer">
          <Toggle
            checked={acuteOn}
            onChange={setAcuteOn}
            label="Acute alerts (default on)"
            sub="Maggie may flag falls, wandering, active medication errors, suicide ideation, or house hazards to family."
          />
          <p className="text-[#6B645A] italic text-xs mt-3 mb-1">Chronic patterns (off by default)</p>
          <Toggle checked={moodOn} onChange={setMoodOn} label="Mood patterns" small />
          <Toggle checked={isolationOn} onChange={setIsolationOn} label="Social isolation patterns" small />
          <Toggle checked={cognitiveOn} onChange={setCognitiveOn} label="Cognitive change patterns" small />
          <Toggle checked={generalOn} onChange={setGeneralOn} label="General concerning content" small />
        </Section>

        <Section title="Personalize her name (coming in a later update)">
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#F9F6F1] border border-[#E7E2D8] opacity-60">
            <div className="flex items-center gap-2">
              <Lock size={14} className="text-[#6B645A]" />
              <p className="text-sm text-[#6B645A]">Rename Maggie (Helper, Mom, etc.)</p>
            </div>
            <span className="text-xs italic text-[#6B645A]">coming soon</span>
          </div>
        </Section>

        {error && (
          <p className="text-[#B5483F] text-sm italic mb-3">{error}</p>
        )}

        <button
          onClick={handleAccept}
          disabled={!canProceed || saving}
          className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold disabled:opacity-40 shadow-[0_2px_6px_rgba(27,54,93,0.15)]"
          style={{ fontSize: '16px' }}
        >
          {saving ? 'Saving...' : "I'm ready, let's start"}
        </button>

        <p className="text-[#6B645A] italic text-xs text-center mt-3">
          You can change any of this in Settings any time.
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <p className="text-[#1B365D] font-semibold mb-2" style={{ fontSize: '14px' }}>{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label, sub, small }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-start justify-between gap-3 p-3 rounded-xl border text-left ${
        checked
          ? 'bg-[#FAF8F4] border-[#D4A843]'
          : 'bg-[#FAF8F4] border-[#E7E2D8]'
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-[#1B365D] ${small ? 'text-sm' : ''}`} style={{ fontSize: small ? '14px' : '15px', fontWeight: 500 }}>
          {label}
        </p>
        {sub && <p className="text-[#6B645A] text-xs italic mt-0.5">{sub}</p>}
      </div>
      <span
        className={`mt-1 relative w-10 h-6 rounded-full flex-shrink-0 transition-colors ${
          checked ? 'bg-[#D4A843]' : 'bg-[#E7E2D8]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}
