import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Send, Bot, Plus, Menu, X, Trash2, MessageSquare,
  Volume2, VolumeX, Mic, MicOff, ArrowLeft,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import BottomNav from '../components/BottomNav'
import useKeyboardHeight from '../hooks/useKeyboardHeight'

const AI_CHAT_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/ai-chat'
const FREE_LIMIT = 10
const PAID_LIMIT = 500

const PLACEHOLDERS = [
  'Ask me anything...',
  'Need help with something?',
  "What's on your mind?",
]

const STARTER_PROMPTS = [
  "What's a good recipe for tonight?",
  'Help me write a birthday card',
  'What documents do we need for a move?',
]

// Emergency keywords — client-side detection before sending to AI
const EMERGENCY_KEYWORDS = [
  'chest pain', "can't breathe", "can't breath", 'not breathing',
  'stroke', 'unconscious', 'unresponsive', 'heart attack',
  'seizure', 'choking', "fell and can't get up", 'bleeding badly',
  'overdose', 'suicide', 'suicidal',
]

function detectEmergencyKeyword(text) {
  const lower = text.toLowerCase()
  for (const kw of EMERGENCY_KEYWORDS) {
    if (lower.includes(kw)) return kw
  }
  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────

function generateTitle(text) {
  const words = text.trim().split(/\s+/).slice(0, 5)
  if (words.length === 0) return 'New conversation'
  const title = words.join(' ')
  const capped = title.charAt(0).toUpperCase() + title.slice(1)
  return text.trim().split(/\s+/).length > 5 ? capped + '...' : capped
}

function getMonthYear() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function groupConversations(convs) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekStart = new Date(today.getTime() - today.getDay() * 86400000)

  const groups = []
  const t = [], y = [], w = [], o = []

  for (const c of convs) {
    const d = new Date(c.created_at)
    if (d >= today) t.push(c)
    else if (d >= yesterday) y.push(c)
    else if (d >= weekStart) w.push(c)
    else o.push(c)
  }

  if (t.length) groups.push({ label: 'Today', items: t })
  if (y.length) groups.push({ label: 'Yesterday', items: y })
  if (w.length) groups.push({ label: 'This Week', items: w })
  if (o.length) groups.push({ label: 'Older', items: o })
  return groups
}

// Pick best English voice
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || []
  const names = ['Samantha', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Victoria', 'Susan', 'Zira']
  for (const n of names) {
    const v = voices.find(v => v.name.includes(n))
    if (v) return v
  }
  return voices.find(v => v.lang.startsWith('en')) || null
}

// ═══════════════════════════════════════════════════════════════════════
//  AIPage Component
// ═══════════════════════════════════════════════════════════════════════

export default function AIPage() {
  const navigate = useNavigate()

  // Auth & profile
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [familyCode, setFamilyCode] = useState('')
  const [tier, setTier] = useState('paid')
  const [aiConsent, setAiConsent] = useState(null) // null=loading, true=consented, false=needs consent

  // Conversations
  const [conversations, setConversations] = useState([])
  const [activeConvId, setActiveConvId] = useState(null)
  const [messages, setMessages] = useState([])

  // Chat
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)

  // Usage
  const [usageCount, setUsageCount] = useState(0)
  const [usageLimit, setUsageLimit] = useState(PAID_LIMIT)

  // UI
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)

  // Voice
  const [soundOn, setSoundOn] = useState(true)
  const [listening, setListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(true)
  const [voiceUnlocked, setVoiceUnlocked] = useState(false)

  // Emergency keyword alert
  const [emergencyAlert, setEmergencyAlert] = useState(null) // { keyword, text }


  // Keyboard height for iOS
  const keyboardHeight = useKeyboardHeight()

  // Refs
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)
  const soundOnRef = useRef(true)

  // ─── Load profile, conversations, usage on mount ──────────────────

  useEffect(() => {
    (async () => {
      try {
        const { data: { user: u } } = await supabase.auth.getUser()
        if (!u) { navigate('/signin'); return }
        setUser(u)

        const { data: prof } = await supabase
          .from('user_profile')
          .select('*')
          .eq('user_id', u.id)
          .single()

        if (!prof) return
        setProfile(prof)
        setAiConsent(!!prof.ai_consent)

        // Resolve family code + tier
        let fc = prof.family_code
        let t = prof.subscription_tier || 'free'
        if (prof.role === 'member' && prof.invited_by) {
          const { data: admin } = await supabase
            .from('user_profile')
            .select('family_code, subscription_tier')
            .eq('user_id', prof.invited_by)
            .single()
          if (admin) { fc = admin.family_code; t = admin.subscription_tier || 'free' }
        }
        setFamilyCode(fc || '')
        setTier(t)
        setUsageLimit(t === 'free' ? FREE_LIMIT : PAID_LIMIT)

        // Load conversations
        const { data: convs } = await supabase
          .from('ai_conversations')
          .select('*')
          .eq('user_id', u.id)
          .order('updated_at', { ascending: false })
        setConversations(convs || [])

        // Load usage
        if (fc) {
          if (t === 'free') {
            const { data: total } = await supabase.rpc('get_family_total_usage', { p_family_code: fc })
            setUsageCount(total || 0)
          } else {
            const { data: mc } = await supabase.rpc('get_family_usage', {
              p_family_code: fc,
              p_month_year: getMonthYear(),
            })
            setUsageCount(mc || 0)
          }
        }
      } catch (err) {
        console.error('AI page data load error:', err)
      }
    })()
  }, [navigate])

  // Placeholder rotation
  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length), 4000)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll (also when keyboard opens/closes)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, keyboardHeight])

  // Voice setup
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    setVoiceSupported(!!SR)
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }
    return () => { recognitionRef.current?.abort(); window.speechSynthesis?.cancel() }
  }, [])

  // ─── Conversation CRUD ─────────────────────────────────────────────

  function startNewChat() {
    setActiveConvId(null)
    setMessages([])
    setSidebarOpen(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function loadConversation(convId) {
    setActiveConvId(convId)
    setSidebarOpen(false)

    const { data: msgs } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })

    setMessages((msgs || []).map(m => ({ role: m.role, content: m.content })))
  }

  async function deleteConversation(convId, e) {
    e?.stopPropagation()
    await supabase.from('ai_conversations').delete().eq('id', convId)
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]) }
  }

  // ─── Voice ─────────────────────────────────────────────────────────

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    soundOnRef.current = next
    if (!next) window.speechSynthesis?.cancel()
  }

  const speakText = useCallback((text) => {
    if (!soundOnRef.current || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.9
    u.pitch = 1.0
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

  // ─── Send message ──────────────────────────────────────────────────

  async function sendMessage(text, bypassEmergencyCheck = false) {
    const userText = (text || input).trim()
    if (!userText || loading) return

    // Emergency keyword detection — intercept before sending to AI
    if (!bypassEmergencyCheck) {
      const matchedKeyword = detectEmergencyKeyword(userText)
      if (matchedKeyword) {
        setEmergencyAlert({ keyword: matchedKeyword, text: userText })
        // Log to Supabase for audit
        supabase.from('emergency_keyword_log').insert({
          user_id: user.id,
          keyword_matched: matchedKeyword,
          message_preview: userText.slice(0, 50),
          user_proceeded: false,
        }).then(() => {}) // fire and forget
        return
      }
    }

    // Limit check (optimistic — server enforces authoritatively)
    if (usageCount >= usageLimit) {
      const msg = tier === 'free'
        ? `You've used all ${FREE_LIMIT} of your free AI messages. Upgrade to Premium for ${PAID_LIMIT} messages per month!`
        : buildLimitMsg()
      setMessages(prev => [...prev, { role: 'user', content: userText }, { role: 'assistant', content: msg }])
      return
    }

    const newMessages = [...messages, { role: 'user', content: userText }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    let convId = activeConvId

    try {
      // Create conversation if none active
      if (!convId) {
        const { data: newConv, error: ce } = await supabase
          .from('ai_conversations')
          .insert({ user_id: user.id, family_code: familyCode || 'unknown', title: generateTitle(userText) })
          .select()
          .single()
        if (ce) throw ce
        convId = newConv.id
        setActiveConvId(convId)
        setConversations(prev => [newConv, ...prev])
      }

      // Save user message to DB
      await supabase.from('ai_messages').insert({ conversation_id: convId, role: 'user', content: userText })

      // Prepare messages for API (truncate long convos: first 4 + last 20)
      let apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))
      if (apiMessages.length > 50) {
        apiMessages = [...apiMessages.slice(0, 4), ...apiMessages.slice(-20)]
      }

      // Recent topics for ambient cross-conversation awareness
      const recentTopics = conversations
        .filter(c => c.id !== convId)
        .slice(0, 3)
        .map(c => c.title)

      // Call edge function
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not logged in')

      const response = await fetch(AI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: apiMessages, recentTopics }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        if (err.error === 'limit_reached') {
          setUsageCount(err.count)
          setUsageLimit(err.limit)
          setMessages(prev => [...prev, { role: 'assistant', content: err.message }])
          speakText(err.message)
          return
        }
        throw new Error(err.error || `Error ${response.status}`)
      }

      // Stream SSE
      setStreaming(true)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let aiText = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          const lines = part.split('\n')
          let eventType = ''
          let eventData = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            if (line.startsWith('data: ')) eventData = line.slice(6)
          }

          if (eventType === 'meta') {
            const meta = JSON.parse(eventData)
            setUsageCount(meta.count)
            setUsageLimit(meta.limit)
            setTier(meta.tier)
          } else if (eventType === 'text') {
            const { text: chunk } = JSON.parse(eventData)
            aiText += chunk
            setMessages(prev => {
              const u = [...prev]
              u[u.length - 1] = { role: 'assistant', content: aiText }
              return u
            })
          } else if (eventType === 'error') {
            throw new Error(JSON.parse(eventData).error)
          }
        }
      }

      // Save assistant message to DB
      if (aiText) {
        await supabase.from('ai_messages').insert({
          conversation_id: convId,
          role: 'assistant',
          content: aiText,
        })
        // Bump conversation updated_at
        await supabase.from('ai_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId)

        // Update local conversation list order
        setConversations(prev => {
          const updated = prev.map(c =>
            c.id === convId ? { ...c, updated_at: new Date().toISOString() } : c
          )
          return updated.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        })
      }

      speakText(aiText)
    } catch (err) {
      const errMsg = "I'm having trouble connecting right now. Please try again in a moment."
      setMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && prev[prev.length - 1].content === '') {
          const u = [...prev]
          u[u.length - 1] = { role: 'assistant', content: errMsg }
          return u
        }
        return [...prev, { role: 'assistant', content: errMsg }]
      })
    } finally {
      setLoading(false)
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  function buildLimitMsg() {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const d = next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    return `Your family has used all ${PAID_LIMIT} messages this month. Your messages refresh on ${d}. Need more? An unlimited plan is coming soon!`
  }

  // ─── Derived state ─────────────────────────────────────────────────

  const firstName = profile?.first_name || ''
  const groups = groupConversations(conversations)
  const isAtLimit = usageCount >= usageLimit
  const ratio = usageLimit > 0 ? usageCount / usageLimit : 0
  const counterColor = ratio >= 0.95 ? 'text-red-500' : ratio >= 0.80 ? 'text-yellow-500' : 'text-gray-400'
  const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  async function handleAiConsent() {
    if (!user) return
    await supabase.from('user_profile').update({
      ai_consent: true,
      ai_consent_date: new Date().toISOString(),
    }).eq('user_id', user.id)
    setAiConsent(true)
  }

  // ═══════════════════════════════════════════════════════════════════
  //  AI Consent Gate — shown before first use
  // ═══════════════════════════════════════════════════════════════════

  if (aiConsent === false) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="bg-white rounded-2xl shadow-lg p-6 max-w-sm w-full flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="bg-[#1B365D] rounded-2xl p-4">
                <Bot size={36} color="#D4A843" strokeWidth={1.5} />
              </div>
              <h2 className="text-[#1B365D] text-xl font-bold">About SeniorSafe AI</h2>
            </div>
            <div className="text-gray-600 text-sm leading-relaxed flex flex-col gap-3">
              <p>
                SeniorSafe's AI assistant is powered by <strong>Anthropic's Claude</strong>. When you use the AI assistant, your messages are sent to Anthropic to generate responses.
              </p>
              <p>
                Anthropic does not store your conversations or use them for training.
              </p>
              <p>
                No medical or financial data from other parts of the app (medications, documents, check-ins) is shared with the AI unless you include it in your message.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleAiConsent}
                className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-base"
              >
                I Understand
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                className="w-full py-3 rounded-xl text-gray-500 font-medium text-sm"
              >
                Not Now
              </button>
            </div>
          </div>
        </div>
        <BottomNav />
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="bg-[#F5F5F5] flex flex-col overflow-hidden" style={{ height: keyboardHeight ? `calc(100vh - ${keyboardHeight}px)` : '100vh' }}>

      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="bg-[#1B365D] px-4 pt-12 pb-4 flex-shrink-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 -ml-2 rounded-lg text-white/70 active:text-white"
              aria-label="Back to Dashboard"
            >
              <ArrowLeft size={22} />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-2 -ml-1 rounded-lg text-white/70 active:text-white"
              aria-label="Toggle conversation history"
            >
              <Menu size={22} />
            </button>
            <div className="bg-[#D4A843] rounded-xl p-2">
              <Bot size={22} color="#1B365D" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white text-lg font-bold leading-tight">SeniorSafe AI</h1>
              <p className="text-white/50 text-xs">Your personal assistant</p>
            </div>
          </div>

          <button
            onClick={toggleSound}
            className="flex items-center gap-1.5 text-white/60 py-2 px-2 rounded-xl"
            title={soundOn ? 'Mute voice' : 'Enable voice'}
          >
            {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            <span className="text-xs hidden sm:inline">{soundOn ? 'Voice on' : 'Muted'}</span>
          </button>
        </div>
      </div>

      {/* iOS voice unlock */}
      {isMobileDevice && soundOn && !voiceUnlocked && (
        <button
          onClick={() => {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))
            setVoiceUnlocked(true)
          }}
          className="flex-shrink-0 bg-[#D4A843]/15 border-b border-[#D4A843]/30 px-4 py-2 text-center text-sm text-[#1B365D] font-medium"
        >
          Tap here to enable voice responses
        </button>
      )}

      {/* ─── Main: Sidebar + Chat ───────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Desktop sidebar */}
        <div className="hidden md:flex flex-col w-72 bg-white border-r border-gray-200 flex-shrink-0">
          <div className="p-3">
            <button
              onClick={startNewChat}
              className="w-full py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-bold text-base flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
            >
              <Plus size={18} /> New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            <ConversationList
              groups={groups}
              activeId={activeConvId}
              onSelect={loadConversation}
              onDelete={deleteConversation}
            />
          </div>
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-40 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 w-80 bg-white z-50 flex flex-col md:hidden shadow-2xl">
              <div className="p-4 flex items-center justify-between border-b" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
                <h2 className="text-[#1B365D] font-bold text-lg">Conversations</h2>
                <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-400">
                  <X size={22} />
                </button>
              </div>
              <div className="p-3">
                <button
                  onClick={startNewChat}
                  className="w-full py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-bold text-base flex items-center justify-center gap-2"
                >
                  <Plus size={18} /> New Chat
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-3">
                <ConversationList
                  groups={groups}
                  activeId={activeConvId}
                  onSelect={loadConversation}
                  onDelete={deleteConversation}
                />
              </div>
            </div>
          </>
        )}

        {/* ─── Chat area ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="max-w-2xl mx-auto flex flex-col gap-4">

              {/* Empty state */}
              {messages.length === 0 && (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="bg-[#D4A843] rounded-2xl p-4">
                    <Bot size={36} color="#1B365D" strokeWidth={1.5} />
                  </div>
                  <p className="text-[#1B365D] font-semibold text-xl">
                    Hi{firstName ? `, ${firstName}` : ''}!
                  </p>
                  <p className="text-gray-500 text-lg leading-relaxed max-w-sm">
                    I&apos;m here to help with anything you need. Ask me about recipes,
                    help with an email, questions about your family&apos;s transition,
                    or anything else on your mind.
                  </p>
                  <div className="flex flex-col gap-3 w-full max-w-sm mt-2">
                    {STARTER_PROMPTS.map(q => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="w-full text-left px-5 py-4 rounded-xl border-2 border-[#1B365D]/20 bg-white text-[#1B365D] font-medium text-lg leading-snug active:scale-[0.98] transition-transform"
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
                    <div className="w-8 h-8 rounded-full bg-[#D4A843] flex items-center justify-center flex-shrink-0 mt-1 mr-2">
                      <Bot size={16} color="#1B365D" strokeWidth={2} />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] px-5 py-4 rounded-2xl whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-[#1B365D] text-white rounded-br-sm'
                        : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'
                    }`}
                    style={{ fontSize: '18px', lineHeight: '1.6' }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Thinking indicator (gentle pulse, not spinner) */}
              {loading && !streaming && (
                <div className="flex justify-start">
                  <div className="w-8 h-8 rounded-full bg-[#D4A843] flex items-center justify-center flex-shrink-0 mt-1 mr-2">
                    <Bot size={16} color="#1B365D" strokeWidth={2} />
                  </div>
                  <div className="bg-white rounded-2xl rounded-bl-sm px-5 py-4 shadow-sm flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-[#D4A843] animate-pulse" />
                      <div className="w-2 h-2 rounded-full bg-[#D4A843] animate-pulse" style={{ animationDelay: '0.2s' }} />
                      <div className="w-2 h-2 rounded-full bg-[#D4A843] animate-pulse" style={{ animationDelay: '0.4s' }} />
                    </div>
                    <span className="text-gray-400 text-base">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* ─── Emergency keyword alert ─────────────────────────── */}
          {emergencyAlert && (
            <div className="flex-shrink-0 bg-red-50 border-t-2 border-red-400 px-4 py-4">
              <div className="max-w-2xl mx-auto flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-lg font-bold">!</span>
                  </div>
                  <div>
                    <p className="text-red-800 font-bold text-base">If this is a medical emergency, call 911 immediately.</p>
                    <p className="text-red-700 text-sm mt-1 leading-relaxed">
                      SeniorSafe is not an emergency service. If someone needs immediate help, please call 911 or your local emergency number.
                    </p>
                  </div>
                </div>
                <a
                  href="tel:911"
                  className="w-full py-4 rounded-xl bg-red-600 text-white font-bold text-lg text-center flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  Call 911
                </a>
                <button
                  onClick={() => {
                    // Log that user proceeded
                    supabase.from('emergency_keyword_log')
                      .update({ user_proceeded: true })
                      .eq('user_id', user.id)
                      .eq('keyword_matched', emergencyAlert.keyword)
                      .order('created_at', { ascending: false })
                      .limit(1)
                      .then(() => {})
                    const savedText = emergencyAlert.text
                    setEmergencyAlert(null)
                    sendMessage(savedText, true)
                  }}
                  className="w-full py-3 rounded-xl border border-gray-300 text-gray-600 font-semibold text-sm"
                >
                  This is not an emergency — send my message
                </button>
              </div>
            </div>
          )}

          {/* ─── Input bar ──────────────────────────────────────── */}
          <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3">
            <form
              onSubmit={e => { e.preventDefault(); sendMessage(input) }}
              className="max-w-2xl mx-auto flex gap-2 items-end"
            >
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
                placeholder={listening ? 'Listening...' : PLACEHOLDERS[placeholderIdx]}
                rows={1}
                disabled={loading || isAtLimit}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-2xl resize-none focus:outline-none focus:border-[#1B365D] text-lg leading-relaxed"
                style={{ maxHeight: '120px' }}
              />

              <button
                type="submit"
                disabled={loading || !input.trim() || isAtLimit}
                className="flex-shrink-0 h-12 px-5 rounded-2xl bg-[#D4A843] text-[#1B365D] font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.97] transition-transform"
              >
                <Send size={18} strokeWidth={2} />
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>

            {/* Usage counter */}
            <p className={`text-center text-xs mt-2 max-w-2xl mx-auto ${counterColor}`}>
              {tier === 'free'
                ? `${usageCount} of ${FREE_LIMIT} free messages used`
                : `${usageCount} / ${PAID_LIMIT} messages this month`
              }
              {isAtLimit && tier === 'free' && (
                <button
                  onClick={() => navigate('/upgrade')}
                  className="ml-2 text-[#D4A843] underline font-semibold"
                >
                  Upgrade
                </button>
              )}
            </p>
            <p className="text-center text-xs text-gray-400 mt-0.5 max-w-2xl mx-auto">
              Powered by Anthropic AI · Not legal or medical advice.
            </p>
          </div>
        </div>
      </div>

      <BottomNav inline />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//  Conversation List (used in both desktop sidebar and mobile drawer)
// ═══════════════════════════════════════════════════════════════════════

function ConversationList({ groups, activeId, onSelect, onDelete }) {
  if (groups.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400 text-sm">
        <MessageSquare size={28} className="mx-auto mb-2 opacity-40" />
        <p>Your conversations will appear here</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(group => (
        <div key={group.label}>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider px-2 mb-1">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map(conv => (
              <div
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`group flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer transition-colors ${
                  conv.id === activeId
                    ? 'bg-[#1B365D]/10 font-semibold'
                    : 'hover:bg-gray-50'
                }`}
              >
                <MessageSquare size={16} className="text-gray-400 flex-shrink-0" />
                <span className="flex-1 text-sm text-gray-700 truncate">
                  {conv.title || 'New conversation'}
                </span>
                <button
                  onClick={e => onDelete(conv.id, e)}
                  className="md:opacity-0 md:group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-opacity flex-shrink-0"
                  aria-label="Delete conversation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
