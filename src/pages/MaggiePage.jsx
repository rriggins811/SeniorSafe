import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, ArrowLeft, Plus, Trash2, Menu, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dismissKeyboard } from '../lib/dismissKeyboard'
import BottomNav from '../components/BottomNav'
import AIMark from '../components/AIMark'
import EmptyConversations from '../components/illustrations/EmptyConversations'
import MaggieConsentModal from '../components/MaggieConsentModal'

const MAGGIE_CHAT_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/maggie-chat'
const SUMMARIZE_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/summarize-conversation'

const STARTER_PROMPTS = [
  "We're starting to look at assisted living. Where do we begin?",
  "Mom won't talk about moving. What do I do?",
  "Cash buyer offered well below market for Mom's house. Should we take it?",
  "I'm exhausted. How do I get my siblings to help?",
]

function generateTitle(text) {
  const t = (text || '').trim().split(/\s+/).slice(0, 6).join(' ')
  return t.length > 60 ? t.slice(0, 57) + '...' : t
}

export default function MaggiePage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [firstName, setFirstName] = useState('')
  const [conversation, setConversation] = useState(null) // active conversation row
  const [messages, setMessages] = useState([]) // [{ role, content }]
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [needsConsent, setNeedsConsent] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [usedToday, setUsedToday] = useState(0)
  const [dailyLimit, setDailyLimit] = useState(100)
  const [tierError, setTierError] = useState('')
  // Phase 1.0c cold-load fix: don't auto-restore the previous conversation.
  // Show a small "Continue last" link in the empty state instead.
  const [lastConvSummary, setLastConvSummary] = useState(null) // { id, title, updated_at }
  const [restoringConv, setRestoringConv] = useState(false)
  // Phase 1.5 conversation sidebar
  const [conversations, setConversations] = useState([]) // recent 30
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // ────────────────────────────────────────────────────────────────────
  // Initial load: auth, consent check, last conversation
  // ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser || cancelled) {
        if (!cancelled) setAuthChecked(true)
        return
      }
      setUser(authUser)

      // Tier gate: /maggie is Premium+ only. Non-Premium+ users (deep links,
      // direct URL nav) get bounced back to the daily-buddy /ai surface.
      const { data: profile } = await supabase
        .from('user_profile')
        .select('first_name, subscription_tier, role, invited_by')
        .eq('user_id', authUser.id)
        .single()
      if (profile?.first_name) setFirstName(profile.first_name)

      let effectiveTier = profile?.subscription_tier || 'free'
      if (profile?.role === 'member' && profile?.invited_by) {
        const { data: admin } = await supabase
          .from('user_profile')
          .select('subscription_tier')
          .eq('user_id', profile.invited_by)
          .single()
        if (admin?.subscription_tier) effectiveTier = admin.subscription_tier
      }
      if (cancelled) return
      if (effectiveTier !== 'premium_plus') {
        navigate('/ai', { replace: true })
        return
      }

      // Consent check: if no row, show modal once
      const { data: consent } = await supabase
        .from('maggie_consent')
        .select('ai_disclosure_acked')
        .eq('user_id', authUser.id)
        .maybeSingle()

      if (!consent?.ai_disclosure_acked) {
        if (!cancelled) {
          setNeedsConsent(true)
          setAuthChecked(true)
        }
        return
      }

      // Phase 1.0c: do NOT auto-restore the previous conversation. Default
      // to a fresh "+ New" empty state. We do still note the most recent
      // conversation so the empty state can offer a "Continue last" link.
      // Phase 1.5: also pull the top 30 for the sidebar history list.
      const { data: convs } = await supabase
        .from('maggie_conversations')
        .select('id, title, updated_at')
        .eq('user_id', authUser.id)
        .order('updated_at', { ascending: false })
        .limit(30)

      if (!cancelled && convs && convs.length > 0) {
        setConversations(convs)
        setLastConvSummary(convs[0])
      }

      if (!cancelled) setAuthChecked(true)
    })()

    return () => { cancelled = true }
  }, [])

  // Phase 1.0d: warm the maggie-chat container on mount so the user's first
  // message doesn't pay cold-start latency or hit a transient cold-container
  // 4xx. Fire and forget — failures are silent.
  useEffect(() => {
    fetch(`${MAGGIE_CHAT_URL}?warmup=1`, { method: 'GET' }).catch(() => {})
  }, [])

  // Auto-scroll to newest message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ block: 'end' })
    }
  }, [messages, streaming])

  // ────────────────────────────────────────────────────────────────────
  // Conversation persistence helpers
  // ────────────────────────────────────────────────────────────────────
  const ensureConversation = useCallback(async (firstUserMessage) => {
    if (conversation || !user) return conversation
    const { data: profile } = await supabase
      .from('user_profile')
      .select('family_code, role, invited_by')
      .eq('user_id', user.id)
      .single()
    let familyCode = profile?.family_code
    if (profile?.role === 'member' && profile?.invited_by) {
      const { data: admin } = await supabase
        .from('user_profile')
        .select('family_code')
        .eq('user_id', profile.invited_by)
        .single()
      if (admin?.family_code) familyCode = admin.family_code
    }
    const { data: created, error } = await supabase
      .from('maggie_conversations')
      .insert({
        user_id: user.id,
        family_code: familyCode || 'unknown',
        title: generateTitle(firstUserMessage),
      })
      .select()
      .single()
    if (error) {
      console.error('Maggie conv create failed', error)
      return null
    }
    setConversation(created)
    // Push into the sidebar list so the user sees their new conversation appear.
    setConversations(prev => [created, ...prev])
    return created
  }, [conversation, user])

  async function persistMessage(convId, role, content) {
    if (!convId) return
    await supabase.from('maggie_messages').insert({
      conversation_id: convId,
      role,
      content,
    })
    await supabase
      .from('maggie_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId)
  }

  // ────────────────────────────────────────────────────────────────────
  // Send a message
  // ────────────────────────────────────────────────────────────────────
  async function sendMessage(text) {
    dismissKeyboard()
    const userText = (text || input).trim()
    if (!userText || loading || streaming) return

    setLoading(true)
    setTierError('')
    const newUserMsg = { role: 'user', content: userText }
    setMessages(prev => [...prev, newUserMsg])
    setInput('')

    // Persist user message + ensure conversation
    const conv = await ensureConversation(userText)
    if (conv) await persistMessage(conv.id, 'user', userText)

    // Get session token for the edge function call
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setLoading(false)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Please sign in again.' }])
      return
    }

    let assistantText = ''
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    setStreaming(true)

    try {
      const res = await fetch(MAGGIE_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [...messages, newUserMsg].map(m => ({ role: m.role, content: m.content })),
          recentTopics: [],
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        if (res.status === 402 && errBody?.error === 'tier_required') {
          setTierError(errBody.message || 'Maggie requires Premium+.')
          setMessages(prev => prev.slice(0, -1)) // drop empty assistant placeholder
          setLoading(false)
          setStreaming(false)
          return
        }
        if (res.status === 429) {
          assistantText = errBody?.message || "I've helped you a lot today. Let's pick this up tomorrow."
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: assistantText }
            return next
          })
          if (conv) await persistMessage(conv.id, 'assistant', assistantText)
          setLoading(false)
          setStreaming(false)
          return
        }
        throw new Error(errBody?.error || `Request failed: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        let event = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const json = line.slice(6).trim()
            if (!json) continue
            try {
              const evt = JSON.parse(json)
              if (event === 'meta') {
                if (typeof evt.used_today === 'number') setUsedToday(evt.used_today)
                if (typeof evt.daily_limit === 'number') setDailyLimit(evt.daily_limit)
              } else if (event === 'text' && evt.text) {
                assistantText += evt.text
                setMessages(prev => {
                  const next = [...prev]
                  next[next.length - 1] = { role: 'assistant', content: assistantText }
                  return next
                })
              }
            } catch { /* skip */ }
          }
        }
      }

      if (conv && assistantText) {
        await persistMessage(conv.id, 'assistant', assistantText)
      }
    } catch (err) {
      const msg = (err && err.message) || 'Something went wrong on my end. Try once more.'
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: msg }
        return next
      })
      if (conv) await persistMessage(conv.id, 'assistant', msg)
    } finally {
      setLoading(false)
      setStreaming(false)
    }
  }

  async function startNewConversation() {
    dismissKeyboard()
    // Phase 1.5 auto-summary: fire-and-forget the compaction job for the
    // conversation we're leaving. Only worth running if there was a real
    // exchange (>= 2 messages = at least one turn each side).
    if (conversation?.id && messages.length >= 2) {
      triggerSummarize(conversation.id, 'maggie')
    }
    // Bump lastConvSummary so the "Continue last" link points at what we
    // just left (in case the user changes their mind before sending).
    if (conversation?.id) {
      setLastConvSummary({
        id: conversation.id,
        title: conversation.title,
        updated_at: new Date().toISOString(),
      })
    }
    setConversation(null)
    setMessages([])
    setInput('')
  }

  async function triggerSummarize(convId, source) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      // Fire and forget. We don't block the UI on the response.
      fetch(SUMMARIZE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ conversation_id: convId, source }),
      }).catch(err => console.error('summarize fetch error', err))
    } catch (err) {
      console.error('summarize trigger failed', err)
    }
  }

  async function restoreLastConversation() {
    if (!lastConvSummary || restoringConv) return
    await loadConversation(lastConvSummary)
  }

  async function loadConversation(conv) {
    if (!conv?.id || restoringConv) return
    // If user is currently in a different conversation with messages, summarize it first.
    if (conversation?.id && conversation.id !== conv.id && messages.length >= 2) {
      triggerSummarize(conversation.id, 'maggie')
    }
    setRestoringConv(true)
    setSidebarOpen(false)
    const { data: msgs } = await supabase
      .from('maggie_messages')
      .select('role, content')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
    setConversation(conv)
    setMessages(msgs || [])
    setRestoringConv(false)
  }

  async function deleteConversation(convId) {
    if (!convId) return
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return
    await supabase.from('maggie_conversations').delete().eq('id', convId)
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (conversation?.id === convId) {
      setConversation(null)
      setMessages([])
    }
    if (lastConvSummary?.id === convId) {
      setLastConvSummary(null)
    }
  }

  function formatLastConvDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) return `today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // ────────────────────────────────────────────────────────────────────
  // Render: consent gate first
  // ────────────────────────────────────────────────────────────────────
  if (needsConsent && user) {
    return (
      <MaggieConsentModal
        userId={user.id}
        onConsented={() => setNeedsConsent(false)}
      />
    )
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex items-center justify-center">
        <p className="text-[#6B645A] italic" style={{ fontSize: '16px' }}>One moment.</p>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────
  // Main chat surface (mirrors AIPage layout pattern + Build 26 height fix)
  // ────────────────────────────────────────────────────────────────────
  return (
    <div
      className="bg-[#FAF8F4] flex flex-col overflow-hidden"
      style={{ height: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))' }}
    >
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-white/70 text-sm mb-3 active:text-white"
            aria-label="Back to home"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 -ml-2 rounded-lg text-white/80 active:text-white"
                aria-label="Open conversation history"
              >
                <Menu size={22} />
              </button>
              <AIMark size={36} />
              <div className="min-w-0">
                <h1 className="text-white leading-tight" style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700 }}>
                  Maggie
                </h1>
                <p className="text-white/70 text-xs italic truncate">Your transition specialist</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {messages.length > 0 && (
                <button
                  onClick={startNewConversation}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/15 text-white text-xs font-medium"
                  aria-label="Start a new conversation"
                >
                  <Plus size={14} /> New
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tier-required banner (rare; the in-page tier gate handles most cases, this catches edge-function-side rejections) */}
      {tierError && (
        <div className="bg-[#F5E1E6]/40 border-b border-[#E7E2D8] px-4 py-3">
          <p className="text-[#1B365D] text-sm">{tierError}</p>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <AIMark size={64} />
              <p className="text-[#1B365D]" style={{ fontFamily: 'var(--font-display)', fontSize: '26px', fontWeight: 700 }}>
                {firstName ? `Hi ${firstName}.` : 'Hi.'}
              </p>
              <p className="text-[#6B645A] italic leading-relaxed max-w-md" style={{ fontSize: '17px' }}>
                I'm Maggie, Ryan's specialist for senior transitions. Tell me what's on your mind. Crisis, planning, or somewhere in between, I'll meet you where you are.
              </p>
              <div className="flex flex-col gap-3 w-full max-w-md mt-2">
                {STARTER_PROMPTS.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="w-full text-left pl-5 pr-5 py-4 rounded-xl bg-white border-l-4 border-[#D4A843] text-[#1B365D] font-medium leading-snug shadow-[0_1px_3px_rgba(45,42,36,0.05)]"
                    style={{ fontSize: '16px' }}
                  >
                    {q}
                  </button>
                ))}
              </div>

              {lastConvSummary && lastConvSummary.id !== conversation?.id && (
                <button
                  type="button"
                  onClick={restoreLastConversation}
                  disabled={restoringConv}
                  className="mt-2 text-[#6B645A] italic text-sm underline disabled:opacity-60"
                  aria-label="Continue your last conversation"
                >
                  {restoringConv
                    ? 'Loading...'
                    : `Continue your last conversation (${formatLastConvDate(lastConvSummary.updated_at)})`}
                </button>
              )}
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 mt-1 mr-2">
                    <AIMark size={32} />
                  </div>
                )}
                <div
                  className={`max-w-[85%] px-5 py-4 rounded-2xl whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-[#1B365D] text-white rounded-br-sm'
                      : 'bg-white text-[#2D2A24] rounded-bl-sm shadow-[0_2px_6px_rgba(45,42,36,0.06)] border border-[#E7E2D8]'
                  }`}
                  style={{ fontSize: '17px', lineHeight: 1.6 }}
                >
                  {msg.content || (streaming && i === messages.length - 1 ? (
                    <span className="text-[#6B645A] italic">Thinking...</span>
                  ) : '')}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 bg-white border-t border-[#E7E2D8] px-4 py-3">
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
            placeholder="What's on your mind?"
            rows={1}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-[#FAF8F4] border border-[#E7E2D8] rounded-2xl resize-none focus:outline-none focus:border-[#1B365D] text-[#2D2A24] leading-relaxed placeholder:italic placeholder:text-[#6B645A]"
            style={{ maxHeight: '120px', fontSize: '17px' }}
          />
          <button
            type="submit"
            disabled={loading || streaming || !input.trim()}
            className="flex-shrink-0 w-12 h-12 rounded-2xl bg-[#1B365D] flex items-center justify-center disabled:opacity-40"
            aria-label="Send"
          >
            <Send size={18} color="#D4A843" strokeWidth={2} />
          </button>
        </form>

        <p className="text-center text-[11px] mt-2 max-w-2xl mx-auto text-[#6B645A]">
          {usedToday} of {dailyLimit} today
        </p>
        <p className="text-center text-[11px] italic text-[#6B645A] mt-0.5 max-w-2xl mx-auto">
          Powered by Anthropic AI. Maggie is not licensed. For legal, financial, or medical decisions, consult a pro in your state.
        </p>
      </div>

      {/* Conversation history drawer */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-label="Conversation history"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div
            className="relative w-80 max-w-[85vw] h-full bg-[#FAF8F4] flex flex-col shadow-2xl border-r border-[#E7E2D8]"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E7E2D8] bg-white">
              <p className="text-[#1B365D]" style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 700 }}>
                Your conversations
              </p>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 text-[#6B645A]"
                aria-label="Close history"
              >
                <X size={20} />
              </button>
            </div>
            <button
              onClick={() => { startNewConversation(); setSidebarOpen(false) }}
              className="m-3 py-3 rounded-xl bg-[#1B365D] text-white font-semibold flex items-center justify-center gap-2"
            >
              <Plus size={16} /> New conversation
            </button>
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {conversations.length === 0 ? (
                <p className="text-[#6B645A] italic text-sm text-center px-4 py-8">
                  No conversations yet. Tap "New conversation" to start.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {conversations.map(c => {
                    const isActive = conversation?.id === c.id
                    return (
                      <li
                        key={c.id}
                        className={`group flex items-start gap-2 rounded-xl px-3 py-2.5 ${
                          isActive ? 'bg-[#F5E1E6]/60' : 'bg-white/50'
                        }`}
                      >
                        <button
                          onClick={() => loadConversation(c)}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className="text-[#1B365D] text-sm font-medium truncate">{c.title || 'New conversation'}</p>
                          <p className="text-[#6B645A] text-xs italic mt-0.5">{formatLastConvDate(c.updated_at)}</p>
                        </button>
                        <button
                          onClick={() => deleteConversation(c.id)}
                          className="p-1 text-[#B0AAA0] hover:text-[#B5483F] opacity-0 group-hover:opacity-100 active:opacity-100"
                          aria-label="Delete conversation"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <p className="text-[#6B645A] italic text-xs text-center px-4 mt-6 leading-relaxed">
                Older conversations roll off after 30. Maggie still remembers your family's situation in the running summary, even after specific chats are archived.
              </p>
            </div>
          </div>
        </div>
      )}

      <BottomNav inline />
    </div>
  )
}
