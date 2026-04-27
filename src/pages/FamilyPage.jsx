import { useState, useEffect, useRef } from 'react'
import { Users, ImagePlus, Send, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import BottomNav from '../components/BottomNav'
import EmptyChat from '../components/illustrations/EmptyChat'
import EmptyPhotos from '../components/illustrations/EmptyPhotos'

// Stable warm accent ring colors so siblings can be distinguished without the chat looking like a playroom.
const AVATAR_RING_COLORS = ['#F5E1E6', '#D4A843', '#F9F6F1', '#DCE1EB']
function ringColorFor(name) {
  if (!name) return AVATAR_RING_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AVATAR_RING_COLORS[Math.abs(hash) % AVATAR_RING_COLORS.length]
}

// Friendlier timestamp: "Today, 12:33 PM" / "Apr 14, 11:53 AM"
function humanTs(ts) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (sameDay) return `Today, ${time}`
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${dateStr}, ${time}`
}

export default function FamilyPage() {
  const [user, setUser] = useState(null)
  const [familyName, setFamilyName] = useState('')
  const [profileName, setProfileName] = useState('')
  const [tab, setTab] = useState('messages') // 'messages' | 'photos'

  // Messages
  const [messages, setMessages] = useState([])
  const [msgLoading, setMsgLoading] = useState(true)
  const [newMsg, setNewMsg] = useState('')
  const [msgPhoto, setMsgPhoto] = useState(null)   // { file, previewUrl }
  const [posting, setPosting] = useState(false)

  // Photos
  const [photos, setPhotos] = useState([])
  const [photoLoading, setPhotoLoading] = useState(true)
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [uploading, setUploading] = useState(false)

  const msgPhotoRef = useRef(null)
  const photoUploadRef = useRef(null)
  const messagesEndRef = useRef(null)

  async function fetchMessages() {
    setMsgLoading(true)
    // No user_id filter — RLS policy scopes to family via family_name
    // Ascending order: oldest at top, newest at bottom (standard chat layout)
    const { data } = await supabase
      .from('family_messages')
      .select('*')
      .order('created_at', { ascending: true })
    const msgs = data || []
    // Resolve photo URLs for messages that have attached photos
    const photoPaths = msgs.filter(m => m.photo_url && !m.photo_url.startsWith('http')).map(m => m.photo_url)
    let signedMap = new Map()
    if (photoPaths.length) {
      const { data: signed } = await supabase.storage.from('Documents').createSignedUrls(photoPaths, 3600)
      if (signed) signed.forEach(s => { if (s.signedUrl) signedMap.set(s.path, s.signedUrl) })
    }
    setMessages(msgs.map(m => {
      if (!m.photo_url || m.photo_url.startsWith('http')) return m
      return { ...m, photo_url: signedMap.get(m.photo_url) || m.photo_url }
    }))
    setMsgLoading(false)
  }

  async function fetchPhotos() {
    setPhotoLoading(true)
    // No user_id filter — RLS policy scopes to family via family_name
    const { data } = await supabase
      .from('family_photos')
      .select('*')
      .order('created_at', { ascending: false })
    const pics = data || []
    // Batch-resolve storage paths to signed URLs
    const paths = pics.filter(p => p.photo_url && !p.photo_url.startsWith('http')).map(p => p.photo_url)
    let signedMap = new Map()
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('Documents').createSignedUrls(paths, 3600)
      if (signed) signed.forEach(s => { if (s.signedUrl) signedMap.set(s.path, s.signedUrl) })
    }
    setPhotos(pics.map(p => {
      if (!p.photo_url || p.photo_url.startsWith('http')) return p
      return { ...p, photo_url: signedMap.get(p.photo_url) || p.photo_url }
    }))
    setPhotoLoading(false)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      fetchMessages()
      fetchPhotos()
      supabase.from('user_profile').select('family_name, first_name, last_name').eq('user_id', user.id).single()
        .then(({ data }) => {
          if (data?.family_name) setFamilyName(data.family_name)
          if (data?.first_name) setProfileName([data.first_name, data.last_name].filter(Boolean).join(' '))
        })

      // Mark family messages as read — update last_family_read_at to now
      supabase.from('user_profile')
        .update({ last_family_read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .then(() => {}) // fire and forget
    })
  }, [])

  // Auto-scroll the message list to the newest message on mount, on tab switch back to messages, and on each new message.
  useEffect(() => {
    if (tab === 'messages' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ block: 'end' })
    }
  }, [tab, messages])

  function authorName() {
    return profileName || user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'Family'
  }

  function handleMsgPhotoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setMsgPhoto({ file, previewUrl: URL.createObjectURL(file) })
    e.target.value = ''
  }

  async function postMessage(e) {
    e.preventDefault()
    if ((!newMsg.trim() && !msgPhoto) || !user) return
    setPosting(true)

    let photoUrl = null
    if (msgPhoto) {
      const ext = msgPhoto.file.name.split('.').pop()
      // UUID-first path satisfies storage RLS: auth.uid() = foldername[1]
      const path = `${user.id}/family-photos/msg-${Date.now()}.${ext}`
      const { error: storageErr } = await supabase.storage.from('Documents').upload(path, msgPhoto.file)
      if (!storageErr) {
        // Store the raw storage path — signed URLs are generated on fetch
        photoUrl = path
      }
    }

    const { error } = await supabase.from('family_messages').insert({
      user_id: user.id,
      family_name: familyName,
      author_name: authorName(),
      message_text: newMsg.trim(),
      photo_url: photoUrl,
    })

    setPosting(false)
    if (!error) {
      setNewMsg('')
      if (msgPhoto?.previewUrl) URL.revokeObjectURL(msgPhoto.previewUrl)
      setMsgPhoto(null)
      fetchMessages()
    }
  }

  async function deleteMessage(id) {
    if (!window.confirm('Delete this message?')) return
    // Find the message to check for attached photo (need original DB path, not signed URL)
    const { data: msg } = await supabase.from('family_messages').select('photo_url').eq('id', id).single()
    if (msg?.photo_url && !msg.photo_url.startsWith('http')) {
      await supabase.storage.from('Documents').remove([msg.photo_url])
    }
    await supabase.from('family_messages').delete().eq('id', id)
    setMessages(prev => prev.filter(m => m.id !== id))
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    // UUID-first path satisfies storage RLS: auth.uid() = foldername[1]
    const path = `${user.id}/family-photos/${Date.now()}.${ext}`
    const { error: storageErr } = await supabase.storage.from('Documents').upload(path, file)
    if (storageErr) { alert('Upload failed: ' + storageErr.message); setUploading(false); return }
    // Store the raw storage path — signed URLs are generated on fetch
    await supabase.from('family_photos').insert({
      user_id: user.id,
      family_name: familyName,
      uploaded_by: authorName(),
      photo_url: path,
    })
    setUploading(false)
    e.target.value = ''
    fetchPhotos()
  }

  async function deletePhoto(photo) {
    if (!window.confirm('Delete this photo?')) return
    // Determine storage path: new format stores raw path, legacy stores full URL
    let storagePath = null
    if (photo.photo_url && !photo.photo_url.startsWith('http')) {
      // New format — photo_url IS the storage path
      storagePath = photo.photo_url
    } else {
      // Legacy format — extract path from full URL
      try {
        const url = new URL(photo.photo_url)
        const marker = '/object/public/Documents/'
        const idx = url.pathname.indexOf(marker)
        if (idx !== -1) storagePath = decodeURIComponent(url.pathname.slice(idx + marker.length))
      } catch { /* ignore invalid URL */ }
    }
    if (storagePath) await supabase.storage.from('Documents').remove([storagePath])
    await supabase.from('family_photos').delete().eq('id', photo.id)
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    if (selectedPhoto?.id === photo.id) setSelectedPhoto(null)
  }

  function formatTs(ts) {
    return humanTs(ts)
  }

  // Family Hub is accessible to all tiers (free users get up to 3 family members)

  return (
    <div className="h-screen bg-[#FAF8F4] flex flex-col overflow-hidden">
      {/* Hidden inputs */}
      <input ref={msgPhotoRef} type="file" accept="image/*" onChange={handleMsgPhotoSelect} className="hidden" />
      <input ref={photoUploadRef} type="file" accept="image/*" onChange={uploadPhoto} className="hidden" />

      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-0 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-white/15 rounded-xl p-2">
              <Users size={20} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white" style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700 }}>Family Hub</h1>
              <p className="text-white/70 text-sm italic">Messages and photos</p>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-6 border-b border-white/10">
            {['messages', 'photos'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative py-3 text-sm font-semibold capitalize transition-colors ${
                  tab === t ? 'text-white' : 'text-white/50'
                }`}
              >
                {t}
                {tab === t && (
                  <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#D4A843] rounded-full" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── MESSAGES TAB ── */}
      {tab === 'messages' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Message list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <div className="max-w-lg mx-auto flex flex-col gap-3">
              {msgLoading ? (
                <p className="text-center text-[#6B645A] italic py-16" style={{ fontSize: '16px' }}>Just a sec, getting your family hub ready.</p>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center gap-3">
                  <div className="w-40 h-40">
                    <EmptyChat />
                  </div>
                  <p className="text-[#1B365D]" style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700 }}>
                    Start the conversation.
                  </p>
                  <p className="text-[#6B645A] italic max-w-xs" style={{ fontSize: '15px' }}>
                    Share updates, encouragement, and news with your family.
                  </p>
                </div>
              ) : (
                messages.map(msg => {
                  const ringColor = ringColorFor(msg.author_name)
                  return (
                    <div key={msg.id} className="bg-white rounded-2xl p-4 shadow-[0_2px_6px_rgba(45,42,36,0.06)] border border-[#E7E2D8]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-9 h-9 rounded-full bg-[#FAF8F4] flex items-center justify-center flex-shrink-0"
                            style={{ boxShadow: `inset 0 0 0 2px ${ringColor}` }}
                          >
                            <span className="text-[#1B365D] text-sm" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                              {msg.author_name?.[0]?.toUpperCase() || 'F'}
                            </span>
                          </div>
                          <div>
                            <p className="text-[#1B365D] font-semibold text-sm">{msg.author_name}</p>
                            <p className="text-[#6B645A] text-xs">{formatTs(msg.created_at)}</p>
                          </div>
                        </div>
                        {msg.user_id === user?.id && (
                          <button onClick={() => deleteMessage(msg.id)} className="p-1 text-[#B0AAA0] hover:text-[#B5483F] flex-shrink-0">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      {msg.message_text && (
                        <p className="mt-3 text-[#2D2A24] leading-relaxed" style={{ fontSize: '16px' }}>
                          {msg.message_text}
                        </p>
                      )}
                      {msg.photo_url && (
                        <img
                          src={msg.photo_url}
                          alt="attachment"
                          className="mt-3 w-full rounded-xl object-cover max-h-64"
                        />
                      )}
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Post message form — anchored above BottomNav, rises with iOS keyboard via Capacitor body resize */}
          <div className="flex-shrink-0 bg-white border-t border-[#E7E2D8] px-4 py-3">
            <div className="max-w-lg mx-auto">
              {msgPhoto && (
                <div className="relative w-20 h-20 mb-2">
                  <img src={msgPhoto.previewUrl} alt="preview" className="w-full h-full object-cover rounded-xl" />
                  <button
                    onClick={() => { URL.revokeObjectURL(msgPhoto.previewUrl); setMsgPhoto(null) }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#1B365D] rounded-full flex items-center justify-center"
                  >
                    <X size={10} color="white" />
                  </button>
                </div>
              )}
              <form onSubmit={postMessage} className="flex gap-2 items-end">
                <button
                  type="button"
                  onClick={() => msgPhotoRef.current?.click()}
                  className="flex-shrink-0 w-12 h-12 rounded-2xl bg-[#FAF8F4] border border-[#E7E2D8] flex items-center justify-center"
                  aria-label="Attach photo"
                >
                  <ImagePlus size={20} color="#1B365D" strokeWidth={1.5} />
                </button>
                <textarea
                  value={newMsg}
                  onChange={e => setNewMsg(e.target.value)}
                  placeholder="Say something to your family..."
                  rows={1}
                  className="flex-1 px-4 py-3 bg-[#FAF8F4] border border-[#E7E2D8] rounded-2xl resize-none focus:outline-none focus:border-[#1B365D] text-[#2D2A24] placeholder:italic placeholder:text-[#6B645A]"
                  style={{ fontSize: '16px', maxHeight: '100px' }}
                />
                <button
                  type="submit"
                  disabled={posting || (!newMsg.trim() && !msgPhoto)}
                  className="flex-shrink-0 w-12 h-12 rounded-2xl bg-[#1B365D] flex items-center justify-center disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send size={18} color="#D4A843" strokeWidth={2} />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── PHOTOS TAB ── */}
      {tab === 'photos' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-lg mx-auto px-4 py-4">
            {/* Upload button — single primary action */}
            <button
              onClick={() => photoUploadRef.current?.click()}
              disabled={uploading}
              className="w-full py-4 rounded-xl bg-[#1B365D] flex items-center justify-center gap-2 text-white font-semibold mb-4 disabled:opacity-60 shadow-[0_2px_6px_rgba(27,54,93,0.15)]"
              style={{ fontSize: '16px' }}
            >
              <ImagePlus size={20} strokeWidth={1.5} />
              {uploading ? 'Uploading...' : 'Add a Photo'}
            </button>

            {photoLoading ? (
              <p className="text-center text-[#6B645A] italic py-16" style={{ fontSize: '16px' }}>Just a sec, getting your family hub ready.</p>
            ) : photos.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center gap-3">
                <div className="w-40 h-40">
                  <EmptyPhotos />
                </div>
                <p className="text-[#1B365D]" style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700 }}>No photos yet.</p>
                <p className="text-[#6B645A] italic max-w-xs" style={{ fontSize: '15px' }}>Share one with your family.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {photos.map(photo => (
                  <div
                    key={photo.id}
                    className="relative aspect-square rounded-xl overflow-hidden bg-[#F9F6F1] border border-[#E7E2D8]"
                    onClick={() => setSelectedPhoto(photo)}
                  >
                    <img src={photo.photo_url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <img
            src={selectedPhoto.photo_url}
            alt=""
            className="max-w-full max-h-[75vh] rounded-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          <div className="flex items-center justify-between w-full max-w-sm mt-4" onClick={e => e.stopPropagation()}>
            <div className="text-white/70 text-sm">
              <p>{selectedPhoto.uploaded_by}</p>
              <p className="text-white/40 text-xs">{formatTs(selectedPhoto.created_at)}</p>
            </div>
            <div className="flex gap-3">
              {selectedPhoto.user_id === user?.id && (
                <button
                  onClick={() => deletePhoto(selectedPhoto)}
                  className="px-4 py-2 rounded-xl bg-red-500/20 text-red-400 text-sm font-semibold"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setSelectedPhoto(null)}
                className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav inline />
    </div>
  )
}
