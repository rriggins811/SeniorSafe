import { useEffect, useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { lookupPartner, normalizePartnerCode } from '../lib/partner'

// "Did someone share Hammock365 with you?" on the owner signup screens.
// If the partner link already told us who, it says so and asks for nothing.
// Otherwise a text link opens a small field. A bad code gets a gentle note and
// never blocks signup: the code is dropped at write time if it is not real.
export default function PartnerCodeField({ linkPartner, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [found, setFound] = useState(null)
  const [checked, setChecked] = useState('')

  // Look the code up a beat after typing stops. Results are keyed to the code
  // they answer, so a stale answer never shows for what is in the box now.
  useEffect(() => {
    const c = normalizePartnerCode(value)
    if (c.length < 2) return
    const t = setTimeout(async () => {
      const p = await lookupPartner(c)
      setFound(p)
      setChecked(c)
    }, 450)
    return () => clearTimeout(t)
  }, [value])

  if (linkPartner && !open) {
    return (
      <p className="flex items-center gap-2 text-[#2D2A24]" style={{ fontSize: '16px' }}>
        <CheckCircle size={18} color="#16A34A" className="flex-shrink-0" />
        <span>Shared with you by <span className="font-semibold">{linkPartner.name}</span>.</span>
      </p>
    )
  }

  if (!open) {
    return (
      <p className="text-gray-600" style={{ fontSize: '16px' }}>
        Did someone share Hammock365 with you?{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[#1B365D] font-semibold underline underline-offset-2"
        >
          Enter their code
        </button>
      </p>
    )
  }

  const c = normalizePartnerCode(value)
  const match = found && found.code === c ? found : null
  const notFound = c.length >= 2 && checked === c && !found

  return (
    <div>
      <label className="block text-gray-700 font-medium mb-2" style={{ fontSize: '16px' }}>
        Partner code <span className="text-gray-400 font-normal">(optional)</span>
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="From their flyer or card"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        className="w-full px-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-[#2D2A24]"
        style={{ fontSize: '18px', paddingTop: '14px', paddingBottom: '14px' }}
      />
      {match && (
        <p className="text-green-800 mt-1.5 flex items-center gap-1.5" style={{ fontSize: '14px' }}>
          <CheckCircle size={16} /> Shared by {match.name}
        </p>
      )}
      {notFound && (
        <p className="text-[#6B645A] mt-1.5" style={{ fontSize: '14px' }}>
          We couldn&rsquo;t find that code. You can still continue, and add it later in Settings.
        </p>
      )}
    </div>
  )
}
