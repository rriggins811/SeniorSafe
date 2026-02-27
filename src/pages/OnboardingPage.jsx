import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

const STEPS = [
  {
    id: 'senior_name',
    question: "What is your loved one's first name?",
    type: 'text',
    placeholder: 'e.g. Margaret',
  },
  {
    id: 'senior_age',
    question: 'How old are they?',
    type: 'number',
    placeholder: 'e.g. 78',
  },
  {
    id: 'living_situation',
    question: 'Where are they currently living?',
    type: 'select',
    options: ['Own Home', 'With Family Member', 'Assisted Living', 'Memory Care', 'Other'],
  },
  {
    id: 'timeline',
    question: 'What is your timeline?',
    type: 'select',
    options: [
      'Just planning ahead — 1–5 years',
      'Starting to prepare — 6–12 months',
      'Actively preparing — 3–6 months',
      'We need to move now',
    ],
  },
  {
    id: 'biggest_concern',
    question: 'What is your biggest concern right now?',
    type: 'select',
    options: [
      'Selling the home',
      'Finding the right community',
      'Legal and financial documents',
      'Family disagreements',
      'Caregiver burnout',
      'Just getting organized',
    ],
  },
  {
    id: 'phone',
    question: 'What is your mobile number?',
    subtitle: "We'll use this to send your family check-in notifications.",
    type: 'tel',
    placeholder: '(336) 555-0100',
    optional: true,
  },
]

const TOTAL = STEPS.length

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [familyName, setFamilyName] = useState('')
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [answers, setAnswers] = useState({
    senior_name: '',
    senior_age: '',
    living_situation: '',
    timeline: '',
    biggest_concern: '',
    phone: '',
  })

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { navigate('/signin'); return }
      setUser(user)
      setFamilyName(user.user_metadata?.family_name || '')
      // Pre-fill phone from metadata if already provided at signup
      if (user.user_metadata?.phone) {
        setAnswers(prev => ({ ...prev, phone: user.user_metadata.phone }))
      }
      supabase
        .from('user_profile')
        .select('onboarding_complete')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.onboarding_complete) navigate('/dashboard', { replace: true })
        })
    })
  }, [navigate])

  const currentValue = () => answers[STEPS[step]?.id] ?? ''
  const canAdvance = () => {
    if (STEPS[step]?.optional) return true
    return String(currentValue()).trim().length > 0
  }
  const setAnswer = (val) => setAnswers(prev => ({ ...prev, [STEPS[step].id]: val }))

  async function handleNext() {
    if (step < TOTAL - 1) { setStep(s => s + 1); return }
    setSaving(true)
    const meta = user.user_metadata || {}
    const role = meta.role || 'admin'
    // Always ensure admins have a family_code — generate one if metadata didn't carry it
    const family_code = role === 'member'
      ? null
      : (meta.family_code || Math.random().toString(36).substr(2, 6).toUpperCase())
    const { error } = await supabase.from('user_profile').upsert({
      user_id: user.id,
      family_name: familyName,
      first_name: meta.first_name || '',
      last_name: meta.last_name || '',
      phone: answers.phone?.trim() || meta.phone || null,
      role,
      family_code,
      invited_by: meta.invited_by || null,
      senior_name: answers.senior_name.trim(),
      senior_age: answers.senior_age ? parseInt(answers.senior_age) : null,
      living_situation: answers.living_situation,
      timeline: answers.timeline,
      biggest_concern: answers.biggest_concern,
      onboarding_complete: true,
    }, { onConflict: 'user_id' })
    setSaving(false)
    if (error) alert('Error saving your profile: ' + error.message)
    else setStep(TOTAL)
  }

  // ── Completion screen ──────────────────────────────────────────────
  if (step === TOTAL) {
    const name = familyName || 'Your'
    const summary = [
      ['Loved one', answers.senior_name + (answers.senior_age ? `, age ${answers.senior_age}` : '')],
      ['Living situation', answers.living_situation],
      ['Timeline', answers.timeline],
      ['Main concern', answers.biggest_concern],
    ]
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div className="bg-[#D4A843] rounded-2xl p-5">
            <CheckCircle size={48} color="#1B365D" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[#1B365D]">
              You&apos;re all set, {name} Family!
            </h1>
            <p className="text-gray-500 text-base mt-2 leading-relaxed">
              SeniorSafe is now personalized for{' '}
              <span className="font-semibold text-[#1B365D]">{answers.senior_name}</span>.
              Every AI response will speak directly to your situation.
            </p>
          </div>
          <div className="w-full flex flex-col gap-2">
            {summary.map(([label, value]) => value && (
              <div key={label} className="bg-[#F5F5F5] rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                <span className="text-gray-500 text-sm">{label}</span>
                <span className="text-[#1B365D] font-semibold text-sm text-right">{value}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg"
          >
            Go to My Dashboard
          </button>
        </div>
      </div>
    )
  }

  // ── Question screens ───────────────────────────────────────────────
  const currentStep = STEPS[step]
  const progressPct = ((step + 1) / TOTAL) * 100

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Navy header with gold progress bar */}
      <div className="bg-[#1B365D] flex-shrink-0">
        <div className="px-6 pt-12 pb-4 max-w-sm mx-auto w-full flex items-center justify-between">
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : null}
            className={`p-2 -ml-2 rounded-lg ${step === 0 ? 'opacity-0 pointer-events-none' : 'text-white/70'}`}
          >
            <ChevronLeft size={24} />
          </button>
          <span className="text-[#D4A843] text-sm font-semibold">
            Question {step + 1} of {TOTAL}
          </span>
          <div className="w-8" />
        </div>
        {/* Gold progress bar */}
        <div className="w-full h-1 bg-white/20">
          <div
            className="h-full bg-[#D4A843] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Question content */}
      <div className="flex-1 px-6 pt-8 pb-6 max-w-sm mx-auto w-full flex flex-col gap-5">
        <div>
          <h1 className="text-[#1B365D] font-bold leading-snug" style={{ fontSize: '22px' }}>
            {currentStep.question}
          </h1>
          {currentStep.subtitle && (
            <p className="text-gray-500 text-base mt-2 leading-relaxed">{currentStep.subtitle}</p>
          )}
          {currentStep.optional && (
            <p className="text-gray-400 text-sm mt-1">Optional — you can skip this step.</p>
          )}
        </div>

        {/* Text / Number input */}
        {(currentStep.type === 'text' || currentStep.type === 'number') && (
          <input
            type={currentStep.type}
            inputMode={currentStep.type === 'number' ? 'numeric' : 'text'}
            value={currentValue()}
            onChange={e => setAnswer(e.target.value)}
            placeholder={currentStep.placeholder}
            autoFocus
            className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-medium"
            style={{ fontSize: '18px' }}
          />
        )}

        {/* Tel input */}
        {currentStep.type === 'tel' && (
          <input
            type="tel"
            inputMode="tel"
            value={currentValue()}
            onChange={e => setAnswer(e.target.value)}
            placeholder={currentStep.placeholder}
            autoFocus
            className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-gray-800 font-medium"
            style={{ fontSize: '18px' }}
          />
        )}

        {/* Option buttons */}
        {currentStep.type === 'select' && (
          <div className="flex flex-col gap-3">
            {currentStep.options.map(opt => {
              const selected = currentValue() === opt
              return (
                <button
                  key={opt}
                  onClick={() => setAnswer(opt)}
                  className={`w-full text-left px-5 py-4 rounded-xl border-2 font-medium transition-colors ${
                    selected
                      ? 'bg-[#1B365D] border-[#1B365D] text-white'
                      : 'bg-white border-gray-200 text-gray-700'
                  }`}
                  style={{ fontSize: '17px' }}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span>{opt}</span>
                    {selected && (
                      <span className="w-6 h-6 rounded-full bg-[#D4A843] flex items-center justify-center flex-shrink-0">
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l2.5 2.5L9 1" stroke="#1B365D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Next button pinned to bottom */}
      <div className="px-6 pb-10 max-w-sm mx-auto w-full flex-shrink-0">
        <button
          onClick={handleNext}
          disabled={!canAdvance() || saving}
          className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg disabled:opacity-40 transition-opacity"
          style={{ fontSize: '18px' }}
        >
          {saving ? 'Saving...' : step === TOTAL - 1 ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  )
}
