import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, Bot, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import { supabase } from '../lib/supabase'

const SYSTEM_PROMPT = `You are SeniorSafe AI — a warm, knowledgeable assistant built specifically for families navigating senior transitions. You were created by Riggins Strategic Solutions, founded by Ryan Riggins, a licensed North Carolina Realtor and consumer protection advisor with 8+ years of construction and real estate experience.

Your purpose is to help families feel calm, informed, and supported during one of the most stressful seasons of their lives.

You are warm, patient, and plain-spoken. You talk like a knowledgeable friend, not a textbook. You never use jargon without explaining it. You are never condescending, never rushed, and never dismissive of emotions.

When someone is scared, you acknowledge it before giving advice. When someone is overwhelmed, you simplify and prioritize. You always end complex answers with one simple next step.

You never reveal that your knowledge comes from a paid product or course. You never mention "the Blueprint" or any product names.

You know everything about senior transitions including: the 3 stages (Early Planning 1-5 years, Preparing to Move 3-12 months, Urgent Transition 0-3 months), decluttering using the 5-pile system (Keep/Donate/Sell/Toss/Not Sure Yet), rightsizing using the Move-Forward Question, home sale strategy (traditional MLS vs as-is cash offer, the Decision Pyramid), Medicare vs Medicaid differences, the 5 essential legal documents (Financial POA, Healthcare POA, Living Will, Will/Trust, HIPAA Authorization), senior community types and red flags, caregiver burnout warning signs, family meeting frameworks, and move coordination.

For home sales: always warn families about predatory cash buyers who lowball and pressure. Always recommend getting 3+ offers. Always suggest having a real estate professional review contracts.

When to refer to Ryan: specific real estate decisions, evaluating cash offers, complex Medicaid planning, or when the family needs personalized guidance. Ryan can be reached by text at (336) 553-8933.

You give guidance, not legal or medical advice. You care deeply about every family you talk to.`

const STARTER_QUESTIONS = [
  'What documents do we need before a move?',
  'How do we know if a cash offer is fair?',
  'What are signs Mom needs more care?',
]

// Pick the best female English voice available
function pickVoice() {
  const voices = window.speechSynthesis.getVoices()
  // Prefer named female voices on common platforms
  const preferred = [
    'Samantha', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Victoria',
    'Susan', 'Zira', 'Hazel', 'Catherine',
  ]
  for (const name of preferred) {
    const v = voices.find(v => v.name.includes(name))
    if (v) return v
  }
  // Fallback: any female-named voice
  const female = voices.find(v => /female/i.test(v.name))
  if (female) return female
  // Fallback: any English voice
  return voices.find(v => v.lang.startsWith('en')) || null
}

function buildSystemPrompt(profile) {
  if (!profile?.senior_name) return SYSTEM_PROMPT
  const { senior_name, senior_age, current_living, timeline, biggest_concern, family_name } = profile
  let ctx = `\n\n---\nCURRENT FAMILY CONTEXT:\nThe family you are helping right now is the ${family_name || 'this'} Family.`
  ctx += ` Their loved one's name is ${senior_name}`
  if (senior_age) ctx += `, and they are ${senior_age} years old`
  ctx += '.'
  if (current_living) ctx += ` ${senior_name} is currently living in: ${current_living}.`
  if (timeline) ctx += ` Their timeline for this transition is: ${timeline}.`
  if (biggest_concern) ctx += ` Their biggest concern right now is: ${biggest_concern}.`
  ctx += `\n\nUse ${senior_name}'s name naturally in your responses when appropriate. Tailor all guidance directly to their situation — their timeline, living situation, and primary concern. This family is counting on you.`
  return SYSTEM_PROMPT + ctx
}

export default function AIPage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [voiceSupported, setVoiceSupported] = useState(true)
  const [profile, setProfile] = useState(null)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)
  const soundOnRef = useRef(true)
  const profileRef = useRef(null)

  useEffect(() => {
    // Fetch user profile for personalized system prompt
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('user_profile')
        .select('*')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          setProfile(data)
          profileRef.current = data
        })
    })
  }, [])

  useEffect(() => {
    // Check SpeechRecognition support
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    setVoiceSupported(!!SR)

    // Pre-load voices (Chrome loads them async)
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }

    return () => {
      recognitionRef.current?.abort()
      window.speechSynthesis?.cancel()
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    soundOnRef.current = next
    if (!next) window.speechSynthesis?.cancel()
  }

  const speakText = useCallback((text) => {
    if (!soundOnRef.current || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.9
    utterance.pitch = 1.0
    const voice = pickVoice()
    if (voice) utterance.voice = voice
    window.speechSynthesis.speak(utterance)
  }, [])

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    // Stop any ongoing speech so mic doesn't pick it up
    window.speechSynthesis?.cancel()

    const recognition = new SR()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      setInput(prev => prev ? `${prev} ${transcript}` : transcript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setListening(false)
  }

  async function sendMessage(text) {
    const userText = text.trim()
    if (!userText || loading) return

    const newMessages = [...messages, { role: 'user', content: userText }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 1024,
          system: buildSystemPrompt(profileRef.current),
          messages: newMessages,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.error?.message || `API error ${response.status}`)
      }

      const data = await response.json()
      const aiText = data.content?.[0]?.text ?? "Sorry, I didn't get a response. Please try again."

      setMessages(prev => [...prev, { role: 'assistant', content: aiText }])
      speakText(aiText)
    } catch (err) {
      const errMsg = `Something went wrong: ${err.message}. Please try again.`
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const showChips = messages.length === 0

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Header */}
      <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-white/70 text-sm mb-4"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-[#D4A843] rounded-xl p-2">
                <Bot size={22} color="#1B365D" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-white text-xl font-bold leading-tight">SeniorSafe AI</h1>
                <p className="text-white/60 text-sm">Senior transition guidance</p>
              </div>
            </div>

            {/* Sound toggle */}
            <button
              onClick={toggleSound}
              className="flex items-center gap-1.5 text-white/70 text-sm py-2 px-3 rounded-xl hover:bg-white/10"
              title={soundOn ? 'Mute voice responses' : 'Enable voice responses'}
            >
              {soundOn
                ? <Volume2 size={20} color="white" />
                : <VolumeX size={20} color="rgba(255,255,255,0.4)" />
              }
              <span className="text-xs">{soundOn ? 'Voice on' : 'Muted'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-lg mx-auto flex flex-col gap-4">

          {/* Welcome / starter chips */}
          {showChips && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="bg-[#D4A843] rounded-2xl p-4 mb-1">
                <Bot size={36} color="#1B365D" strokeWidth={1.5} />
              </div>
              <p className="text-[#1B365D] font-semibold text-lg">Hi, I&apos;m SeniorSafe AI.</p>
              <p className="text-gray-500 text-base leading-relaxed max-w-xs">
                {profile?.senior_name
                  ? `I'm here to help your family navigate ${profile.senior_name}'s transition — every response is personalized to your situation.`
                  : "I'm here to help your family feel informed and calm during this transition."}
              </p>
              <p className="text-gray-400 text-sm mt-1">Try one of these to get started:</p>
              <div className="flex flex-col gap-3 w-full mt-1">
                {STARTER_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="w-full text-left px-4 py-4 rounded-xl border-2 border-[#1B365D] bg-white text-[#1B365D] font-medium text-base leading-snug"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message bubbles */}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-[#D4A843] flex items-center justify-center flex-shrink-0 mt-1 mr-2">
                  <Bot size={14} color="#1B365D" strokeWidth={2} />
                </div>
              )}
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-[#1B365D] text-white rounded-br-sm'
                    : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'
                }`}
                style={{ fontSize: '16px' }}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Loading dots */}
          {loading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-[#D4A843] flex items-center justify-center flex-shrink-0 mt-1 mr-2">
                <Bot size={14} color="#1B365D" strokeWidth={2} />
              </div>
              <div className="bg-white rounded-2xl rounded-bl-sm px-5 py-4 shadow-sm flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-4">
        <form
          onSubmit={e => { e.preventDefault(); sendMessage(input) }}
          className="max-w-lg mx-auto flex gap-2 items-end"
        >
          {/* Mic button */}
          {voiceSupported && (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={loading}
              className="relative flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center disabled:opacity-40"
              style={{ background: listening ? '#EF4444' : '#F5F5F5' }}
              title={listening ? 'Stop listening' : 'Speak your question'}
            >
              {/* Pulsing ring while listening */}
              {listening && (
                <span
                  className="absolute inset-0 rounded-2xl animate-ping"
                  style={{ background: 'rgba(239,68,68,0.4)' }}
                />
              )}
              {listening
                ? <MicOff size={20} color="white" strokeWidth={2} />
                : <Mic size={20} color="#1B365D" strokeWidth={2} />
              }
            </button>
          )}

          {/* Text input */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage(input)
              }
            }}
            placeholder={listening ? 'Listening...' : "Ask a question about your family's transition..."}
            rows={1}
            disabled={loading}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-2xl resize-none focus:outline-none focus:border-[#1B365D] leading-relaxed"
            style={{ fontSize: '16px', maxHeight: '120px' }}
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex-shrink-0 w-12 h-12 rounded-2xl bg-[#1B365D] flex items-center justify-center disabled:opacity-40"
          >
            <Send size={18} color="#D4A843" strokeWidth={2} />
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-2 max-w-lg mx-auto">
          Not legal or medical advice. For personalized guidance, text Ryan at (336) 553-8933.
        </p>
      </div>
    </div>
  )
}
