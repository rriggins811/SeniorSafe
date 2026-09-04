import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, ArrowLeft, Plus, Trash2, Menu, X, Volume2, VolumeX, Mic, MicOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dismissKeyboard } from '../lib/dismissKeyboard'
import BottomNav from '../components/BottomNav'
import AIMark from '../components/AIMark'
import EmptyConversations from '../components/illustrations/EmptyConversations'

// Maggie, the one SeniorSafe assistant (2026-09-04 merge). Same page for the
// senior and the family; the server knows who is typing and adjusts. Seniors
// get voice on by default and everyday starter prompts. Conversations live in
// ai_conversations / ai_messages for everyone.

const AI_CHAT_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/ai-chat'
const SUMMARIZE_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/summarize-conversation'
const FREE_LIMIT = 10
const PAID_LIMIT = 500

const SENIOR_PROMPTS = [
  "What's a good recipe for tonight?",
  'Help me write a birthday card',
  'How do I make the writing on my phone bigger?',
  'Tell me something that will make me smile',
]
const FAMILY_PROMPTS = [
  "We're starting to look at assisted living. Where do we begin?",
  "Mom won't talk about moving. What do I do?",
  "A cash buyer offered well below market for Mom's house. Should we take it?",
  "I'm exhausted. How do I get my siblings to help?",
]

// Client-side tripwire before anything goes to the model.
const EMERGENCY_KEYWORDS = [
  'chest pain', "can't breathe", "can't breath", 'not breathing',
  'stroke', 'unconscious', 'unresponsive', 'heart attack',
  'seizure', 'choking', "fell and can't get up", 'bleeding badly',
  'overdose', 'suicide', 'suicidal',
]
function detectEmergencyKeyword(text) {
  const lower = text.toLowerCase()
  return EMERGENCY_KEYWORDS.find(kw => lower.includes(kw)) || null
}

function generateTitle(text) {
  const t = (text || '').trim().split(/\s+/).slice(0, 6).join(' ')
  return t.length > 60 ? t.slice(0, 57) + '...' : t || 'New conversation'
}

function getMonthYear() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || []
  const names = ['Samantha', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Victoria', 'Susan', 'Zira']
  for (const n of names) {
    const v = voices.find(v => v.name.includes(n))
    if (v) return v
  }
  return voices.find(v => v.lang.startsWith('en')) || null
}

function renderRich(text) {
  if (!text) return text
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  )
}

function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function MaggiePage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tier, setTier] = useState('paid')
  const [familyCode, setFamilyCode] = useState('')
  const [needsConsent, setNeedsConsent] = useState(false)
  const [consentSaving, setConsentSaving] = useState(false)
  const [ready, setReady] = useState(false)

  const [conversations, setConversations] = useState([])
  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [lastConvSummary, setLastConvSummary] = useState(null)
  const [restoringConv, setRestoringConv] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [usageCount, setUsageCount] = useState(0)
  const [usageLimit, setUsageLimit] = useState(PAID_LIMIT)
  const [notice, setNotice] = useState('')
  const [emergencyAlert, setEmergencyAlert] = useState(null)

  const [soundOn, setSoundOn] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [voiceUnlocked, setVoiceUnlocked] = useState(false)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)
  const soundOnRef = useRef(false)

  const isSenior = !!profile?.is_senior
  const firstName = profile?.first_name || ''

  // ─── Load ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) { navigate('/signin'); return }
      if (cancelled) return
      setUser(u)

      const { data: prof } = await supabase
        .from('user_profile')
        .select('first_name, is_senior, role, invited_by, subscription_tier, ai_consent, family_code')
        .eq('user_id', u.id)
        .single()
      if (!prof || cancelled) { setReady(true); return }
      setProfile(prof)

      let fc = prof.family_code
      let t = prof.subscription_tier || 'free'
      if (prof.invited_by) {
        const { data: owner } = await supabase
          .from('user_profile')
          .select('family_code, subscription_tier')
          .eq('user_id', prof.invited_by)
          .single()
        if (owner) { fc = owner.family_code; t = owner.subscription_tier || 'free' }
      }
      if (cancelled) return
      setFamilyCode(fc || '')
      setTier(t)
      setUsageLimit(t === 'free' ? FREE_LIMIT : PAID_LIMIT)

      // Seniors hear Maggie by default; everyone can toggle.
      const wantSound = !!prof.is_senior
      setSoundOn(wantSound)
      soundOnRef.current = wantSound

      if (!prof.ai_consent) { setNeedsConsent(true); setReady(true); return }

      const { data: convs } = await supabase
        .from('ai_conversations')
        .select('id, title, updated_at')
        .eq('user_id', u.id)
        .order('updated_at', { ascending: false })
        .limit(30)
      if (!cancelled && convs?.length) {
        setConversations(convs)
        setLastConvSummary(convs[0])
      }

      if (fc) {
        if (t === 'free') {
          const { data: total } = await supabase.rpc('get_family_total_usage', { p_family_code: fc })
          if (!cancelled) setUsageCount(total || 0)
        } else {
          const { data: mc } = await supabase.rpc('get_family_usage', { p_family_code: fc, p_month_year: getMonthYear() })
          if (!cancelled) setUsageCount(mc || 0)
        }
      }
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [navigate])

  // Warm the function so the first reply is not a cold start.
  useEffect(() => {
    fetch(`${AI_CHAT_URL}?warmup=1`, { method: 'GET' }).catch(() => {})
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming])

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    setVoiceSupported(!!SR)
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }
    return () => { recognitionRef.current?.abort(); window.speechSynthesis?.cancel() }
  }, [])

  // ─── Consent ────────────────────────────────────────────────────────
  async function acceptConsent() {
    if (!user || consentSaving) return
    setConsentSaving(true)
    const { error } = await supabase.from('user_profile')
      .update({ ai_consent: true, ai_consent_date: new Date().toISOString() })
      .eq('user_id', user.id)
    setConsentSaving(false)
    if (error) { setNotice('Could not save that. Please try again.'); return }
    setNeedsConsent(false)
    setProfile(p => ({ ...p, ai_consent: true }))
  }

  // ─── Voice ──────────────────────────────────────────────────────────
  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    soundOnRef.current = next
    if (!next) window.speechSynthesis?.cancel()
  }
  const speakText = useCallback((text) => {
    if (!soundOnRef.current || !window.speechSynthesis || !text) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#]/g, ''))
    u.rate = 0.9
    const v = pickVoice()
    if (v) u.voice = v
    window.speechSynthesis.speak(u)
  }, [])
  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    window.speechSynthesis?.cancel()
    const r = new SR()
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1
    r.onresult = (e) => setInput(prev => prev ? `${prev} ${e.results[0][0].transcript}` : e.results[0][0].transcript)
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recognitionRef.current = r
    r.start()
    setListening(true)
  }
  function stopListening() {
    recognitionRef.current?.stop()
    setListening(false)
  }

  // ─── Conversations ──────────────────────────────────────────────────
  const ensureConversation = useCallback(async (firstUserMessage) => {
    if (conversation || !user) return conversation
    const { data: created, error } = await supabase
      .from('ai_conversations')
      .insert({ user_id: user.id, family_code: familyCode || 'unknown', title: generateTitle(firstUserMessage) })
      .select()
      .single()
    if (error) { console.error('conversation create failed', error); return null }
    setConversation(created)
    setConversations(prev => [created, ...prev])
    return created
  }, [conversation, user, familyCode])

  async function persistMessage(convId, role, content) {
    if (!convId) return
    await supabase.from('ai_messages').insert({ conversation_id: convId, role, content })
    await supabase.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)
  }

  async function triggerSummarize(convId) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      fetch(SUMMARIZE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ conversation_id: convId, source: 'senior_safe' }),
      }).catch(err => console.error('summarize fetch error', err))
    } catch (err) {
      console.error('summarize trigger failed', err)
    }
  }

  function startNewConversation() {
    dismissKeyboard()
    if (conversation?.id && messages.length >= 2) triggerSummarize(conversation.id)
    if (conversation?.id) setLastConvSummary({ id: conversation.id, title: conversation.title, updated_at: new Date().toISOString() })
    setConversation(null)
    setMessages([])
    setInput('')
    setSidebarOpen(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function loadConversation(conv) {
    if (!conv?.id || restoringConv) return
    if (conversation?.id && conversation.id !== conv.id && messages.length >= 2) triggerSummarize(conversation.id)
    setRestoringConv(true)
    setSidebarOpen(false)
    const { data: msgs } = await supabase
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
    setConversation(conv)
    setMessages(msgs || [])
    setRestoringConv(false)
  }

  async function deleteConversation(convId, e) {
    e?.stopPropagation()
    if (!convId) return
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return
    await supabase.from('ai_conversations').delete().eq('id', convId)
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (conversation?.id === convId) { setConversation(null); setMessages([]) }
    if (lastConvSummary?.id === convId) setLastConvSummary(null)
  }

  // ─── Send ───────────────────────────────────────────────────────────
  async function sendMessage(text, bypassEmergencyCheck = false) {
    dismissKeyboard()
    const userText = (text || input).trim()
    if (!userText || loading || streaming) return

    if (!bypassEmergencyCheck) {
      const kw = detectEmergencyKeyword(userText)
      if (kw) {
        setEmergencyAlert({ keyword: kw, text: userText })
        supabase.from('emergency_keyword_log').insert({
          user_id: user.id, keyword_matched: kw, message_preview: userText.slice(0, 50), user_proceeded: false,
        }).then(() => {})
        return
      }
    }

    if (usageCount >= usageLimit) {
      setNotice(tier === 'free'
        ? `You've used all ${FREE_LIMIT} free messages with Maggie. The paid plan includes her every day.`
        : `Your family has used this month's ${PAID_LIMIT} messages. They refresh on the 1st.`)
      return
    }

    setLoading(true)
    setNotice('')
    const newUserMsg = { role: 'user', content: userText }
    const newMessages = [...messages, newUserMsg]
    setMessages(newMessages)
    setInput('')

    const conv = await ensureConversation(userText)
    if (conv) await persistMessage(conv.id, 'user', userText)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setLoading(false)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Please sign in again.' }])
      return
    }

    let apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))
    if (apiMessages.length > 50) apiMessages = [...apiMessages.slice(0, 4), ...apiMessages.slice(-20)]
    const recentTopics = conversations.filter(c => c.id !== conv?.id).slice(0, 3).map(c => c.title)

    let assistantText = ''
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    setStreaming(true)

    try {
      const res = await fetch(AI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: apiMessages, recentTopics }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (err.error === 'limit_reached' || err.error === 'BUDGET_EXCEEDED') {
          if (typeof err.count === 'number') setUsageCount(err.count)
          if (typeof err.limit === 'number') setUsageLimit(err.limit)
          assistantText = err.message || 'Maggie is out of messages for now.'
          setMessages(prev => { const n = [...prev]; n[n.length - 1] = { role: 'assistant', content: assistantText }; return n })
          if (conv) await persistMessage(conv.id, 'assistant', assistantText)
          return
        }
        throw new Error(err.error || `Request failed: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const part of parts) {
          let eventType = '', eventData = ''
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            if (line.startsWith('data: ')) eventData = line.slice(6)
          }
          if (!eventData) continue
          if (eventType === 'meta') {
            const meta = JSON.parse(eventData)
            if (typeof meta.count === 'number') setUsageCount(meta.count)
            if (typeof meta.limit === 'number') setUsageLimit(meta.limit)
            if (meta.tier) setTier(meta.tier)
          } else if (eventType === 'text') {
            assistantText += JSON.parse(eventData).text || ''
            setMessages(prev => { const n = [...prev]; n[n.length - 1] = { role: 'assistant', content: assistantText }; return n })
          } else if (eventType === 'error') {
            throw new Error(JSON.parse(eventData).error)
          }
        }
      }

      if (conv && assistantText) {
        await persistMessage(conv.id, 'assistant', assistantText)
        setConversations(prev => {
          const updated = prev.map(c => c.id === conv.id ? { ...c, updated_at: new Date().toISOString() } : c)
          return updated.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        })
      }
      speakText(assistantText)
    } catch (err) {
      console.error('Maggie send failed', err)
      const msg = "I'm having trouble connecting right now. Please try again in a moment."
      setMessages(prev => { const n = [...prev]; n[n.length - 1] = { role: 'assistant', content: msg }; return n })
    } finally {
      setLoading(false)
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex items-center justify-center">
        <p className="text-[#6B645A] italic" style={{ fontSize: '16px' }}>One moment.</p>
      </div>
    )
  }

  if (needsConsent) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="bg-white rounded-2xl shadow-lg p-6 max-w-sm w-full flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <AIMark size={56} />
              <h2 className="text-[#1B365D]" style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700 }}>Meet Maggie</h2>
            </div>
            <div className="text-[#2D2A24] flex flex-col gap-3" style={{ fontSize: '17px', lineHeight: 1.5 }}>
              <p>Maggie is an assistant Ryan built. She can help with everyday things and with the bigger questions about looking after a parent.</p>
              <p>She is not a doctor, a lawyer, or a financial advisor. For those decisions she will point you to the right person.</p>
              <p>Your chats are private to you. Maggie keeps a short running summary so you do not have to repeat yourself; you can clear it in Settings any time.</p>
            </div>
            {notice && <p className="text-[#B5483F] text-base">{notice}</p>}
            <button onClick={acceptConsent} disabled={consentSaving} className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold disabled:opacity-60" style={{ fontSize: '18px' }}>
              {consentSaving ? 'One moment...' : 'Okay, let\'s talk'}
            </button>
            <button onClick={() => navigate('/dashboard')} className="w-full py-3 rounded-xl text-gray-500 font-medium" style={{ fontSize: '16px' }}>Not now</button>
          </div>
        </div>
        {profile && !isSenior && <BottomNav />}
      </div>
    )
  }

  const starters = isSenior ? SENIOR_PROMPTS : FAMILY_PROMPTS
  const isAtLimit = usageCount >= usageLimit
  const ratio = usageLimit > 0 ? usageCount / usageLimit : 0
  const counterColor = ratio >= 0.95 ? 'text-[#B5483F]' : ratio >= 0.8 ? 'text-[#8A6A1E]' : 'text-[#6B645A]'
  const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const bubbleSize = isSenior ? '19px' : '17px'

  return (
    <div className="bg-[#FAF8F4] flex flex-col overflow-hidden" style={{ height: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))' }}>
      <div className="bg-[#1B365D] px-4 pt-12 pb-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => navigate('/dashboard')} className="p-2 -ml-2 rounded-lg text-white/80 active:text-white min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Back to home">
              <ArrowLeft size={24} />
            </button>
            <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg text-white/80 active:text-white min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Your conversations">
              <Menu size={24} />
            </button>
            <AIMark size={36} />
            <div className="min-w-0">
              <h1 className="text-white leading-tight" style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700 }}>Maggie</h1>
              <p className="text-white/70 text-xs italic truncate">{isSenior ? 'Here for everyday help' : 'Your transition specialist'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={toggleSound} className="flex items-center gap-1.5 text-white/80 py-2 px-2 rounded-xl min-h-[44px]" aria-label={soundOn ? 'Turn voice off' : 'Turn voice on'}>
              {soundOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
              <span className="text-xs hidden sm:inline">{soundOn ? 'Voice on' : 'Voice off'}</span>
            </button>
            {messages.length > 0 && (
              <button onClick={startNewConversation} className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/15 text-white text-sm font-medium min-h-[44px]" aria-label="Start a new conversation">
                <Plus size={16} /> New
              </button>
            )}
          </div>
        </div>
      </div>

      {isMobileDevice && soundOn && !voiceUnlocked && (
        <button
          onClick={() => { window.speechSynthesis?.speak(new SpeechSynthesisUtterance('')); setVoiceUnlocked(true) }}
          className="flex-shrink-0 bg-[#D4A843]/15 border-b border-[#D4A843]/30 px-4 py-3 text-center text-[#1B365D] font-medium"
          style={{ fontSize: '16px' }}
        >
          Tap here so Maggie can read her answers out loud
        </button>
      )}

      {notice && (
        <div className="flex-shrink-0 bg-[#F5E1E6]/50 border-b border-[#E7E2D8] px-4 py-3 flex items-center gap-3">
          <p className="text-[#1B365D] flex-1" style={{ fontSize: '15px' }}>{notice}</p>
          {tier === 'free' && <button onClick={() => navigate('/upgrade')} className="text-[#1B365D] font-semibold underline text-sm">See the paid plan</button>}
          <button onClick={() => setNotice('')} aria-label="Dismiss" className="text-[#6B645A]"><X size={18} /></button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <AIMark size={64} />
              <p className="text-[#1B365D]" style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700 }}>
                {firstName ? `Hi ${firstName}.` : 'Hi.'}
              </p>
              <p className="text-[#6B645A] italic leading-relaxed max-w-md" style={{ fontSize: '17px' }}>
                {isSenior
                  ? "I'm Maggie. Ask me anything: a recipe, help with a card, how to do something on your phone, or just say hello."
                  : "I'm Maggie, Ryan's specialist for looking after a parent. Crisis, planning, or somewhere in between, tell me what's on your mind."}
              </p>
              <div className="flex flex-col gap-3 w-full max-w-md mt-2">
                {starters.map(q => (
                  <button key={q} onClick={() => sendMessage(q)} className="w-full text-left px-5 py-4 rounded-xl bg-white border-l-4 border-[#D4A843] text-[#1B365D] font-medium leading-snug shadow-[0_1px_3px_rgba(45,42,36,0.05)]" style={{ fontSize: bubbleSize }}>
                    {q}
                  </button>
                ))}
              </div>
              {lastConvSummary && lastConvSummary.id !== conversation?.id && (
                <button type="button" onClick={() => loadConversation(lastConvSummary)} disabled={restoringConv} className="mt-2 text-[#6B645A] italic underline disabled:opacity-60" style={{ fontSize: '15px' }}>
                  {restoringConv ? 'Loading...' : `Continue your last conversation (${formatWhen(lastConvSummary.updated_at)})`}
                </button>
              )}
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <div className="flex-shrink-0 mt-1 mr-2"><AIMark size={32} /></div>}
                <div
                  className={`max-w-[85%] px-5 py-4 rounded-2xl whitespace-pre-wrap ${msg.role === 'user' ? 'bg-[#1B365D] text-white rounded-br-sm' : 'bg-white text-[#2D2A24] rounded-bl-sm shadow-[0_2px_6px_rgba(45,42,36,0.06)] border border-[#E7E2D8]'}`}
                  style={{ fontSize: bubbleSize, lineHeight: 1.6 }}
                >
                  {msg.content ? renderRich(msg.content) : (streaming && i === messages.length - 1 ? <span className="text-[#6B645A] italic">Thinking...</span> : '')}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {emergencyAlert && (
        <div className="flex-shrink-0 bg-red-50 border-t-2 border-red-400 px-4 py-4">
          <div className="max-w-2xl mx-auto flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#B5483F] flex items-center justify-center flex-shrink-0"><span className="text-white text-lg font-bold">!</span></div>
              <div>
                <p className="text-red-800 font-bold" style={{ fontSize: '17px' }}>If this is an emergency, call 911 right now.</p>
                <p className="text-red-700 mt-1 leading-relaxed" style={{ fontSize: '15px' }}>Maggie is not an emergency service. The I Need Help button on the home screen texts your whole family.</p>
              </div>
            </div>
            <a href="tel:911" className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg text-center flex items-center justify-center gap-2 active:scale-[0.98]">Call 911</a>
            <button
              onClick={() => {
                supabase.from('emergency_keyword_log').update({ user_proceeded: true }).eq('user_id', user.id).eq('keyword_matched', emergencyAlert.keyword).order('created_at', { ascending: false }).limit(1).then(() => {})
                const saved = emergencyAlert.text
                setEmergencyAlert(null)
                sendMessage(saved, true)
              }}
              className="w-full py-3 rounded-xl border border-gray-300 text-gray-600 font-semibold text-sm"
            >
              This is not an emergency, send my message
            </button>
          </div>
        </div>
      )}

      <div className="flex-shrink-0 bg-white border-t border-[#E7E2D8] px-4 py-3">
        <form onSubmit={e => { e.preventDefault(); sendMessage(input) }} className="max-w-2xl mx-auto flex gap-2 items-end">
          {voiceSupported && (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              className={`flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${listening ? 'bg-[#B5483F]' : 'bg-[#F3EFE7]'}`}
              aria-label={listening ? 'Stop listening' : 'Speak instead of typing'}
            >
              {listening ? <MicOff size={20} color="white" /> : <Mic size={20} color="#1B365D" />}
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
            placeholder={listening ? 'Listening...' : "What's on your mind?"}
            rows={1}
            disabled={loading || isAtLimit}
            className="flex-1 px-4 py-3 bg-[#FAF8F4] border border-[#E7E2D8] rounded-2xl resize-none focus:outline-none focus:border-[#1B365D] text-[#2D2A24] leading-relaxed placeholder:italic placeholder:text-[#6B645A]"
            style={{ maxHeight: '120px', fontSize: bubbleSize }}
          />
          <button type="submit" disabled={loading || streaming || !input.trim() || isAtLimit} className="flex-shrink-0 w-12 h-12 rounded-2xl bg-[#1B365D] flex items-center justify-center disabled:opacity-40" aria-label="Send">
            <Send size={18} color="#D4A843" strokeWidth={2} />
          </button>
        </form>
        <p className={`text-center text-[12px] mt-2 max-w-2xl mx-auto ${counterColor}`}>
          {tier === 'free' ? `${usageCount} of ${FREE_LIMIT} free messages used, total` : `${usageCount} of ${PAID_LIMIT} this month`}
          {isAtLimit && tier === 'free' && (
            <button onClick={() => navigate('/upgrade')} className="ml-2 text-[#8A6A1E] underline font-semibold">See the paid plan</button>
          )}
        </p>
        <p className="text-center text-[12px] italic text-[#6B645A] mt-0.5 max-w-2xl mx-auto">
          Maggie is an AI, not a doctor, lawyer, or financial advisor.
        </p>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="Your conversations">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <div className="relative w-80 max-w-[85vw] h-full bg-[#FAF8F4] flex flex-col shadow-2xl border-r border-[#E7E2D8]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E7E2D8] bg-white">
              <p className="text-[#1B365D]" style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 700 }}>Your conversations</p>
              <button onClick={() => setSidebarOpen(false)} className="p-2 text-[#6B645A] min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close"><X size={22} /></button>
            </div>
            <button onClick={startNewConversation} className="m-3 py-3 rounded-xl bg-[#1B365D] text-white font-semibold flex items-center justify-center gap-2 text-base">
              <Plus size={16} /> New conversation
            </button>
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {conversations.length === 0 ? (
                <div className="text-center py-8 px-4 flex flex-col items-center gap-3">
                  <div className="w-24 h-24 opacity-90"><EmptyConversations /></div>
                  <p className="text-[#6B645A] italic text-sm">No conversations yet.</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {conversations.map(c => (
                    <li key={c.id} className={`group flex items-start gap-2 rounded-xl px-3 py-2.5 ${conversation?.id === c.id ? 'bg-[#F5E1E6]/60' : 'bg-white/50'}`}>
                      <button onClick={() => loadConversation(c)} className="flex-1 text-left min-w-0">
                        <p className="text-[#1B365D] text-sm font-medium truncate">{c.title || 'New conversation'}</p>
                        <p className="text-[#6B645A] text-xs italic mt-0.5">{formatWhen(c.updated_at)}</p>
                      </button>
                      <button onClick={(e) => deleteConversation(c.id, e)} className="p-2 text-[#B0AAA0] hover:text-[#B5483F]" aria-label="Delete conversation"><Trash2 size={16} /></button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[#6B645A] italic text-xs text-center px-4 mt-6 leading-relaxed">
                Maggie keeps a short running summary of your family's situation even after older chats roll off. You can clear it in Settings.
              </p>
            </div>
          </div>
        </div>
      )}

      {profile && !isSenior && <BottomNav inline />}
    </div>
  )
}
