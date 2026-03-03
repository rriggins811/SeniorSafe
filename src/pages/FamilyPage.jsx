import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, ImagePlus, Send, Trash2, X, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import BottomNav from '../components/BottomNav'

export default function FamilyPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [subscriptionTier, setSubscriptionTier] = useState('paid')
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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      fetchMessages()
      fetchPhotos()
      supabase.from('user_profile').select('subscription_tier').eq('user_id', user.id).single()
        .then(({ data }) => setSubscriptionTier(data?.subscription_tier || 'paid'))
    })
  }, [])

  // Resolve a photo_url to a viewable URL (handles both legacy full URLs and storage paths)
  async function resolvePhotoUrl(storedUrl) {
    if (!storedUrl) return ''
    // Legacy full URL — already viewable (or broken if bucket went private)
    if (storedUrl.startsWith('http')) return storedUrl
    // Storage path — generate a signed URL (1 hour expiry)
    const { data } = await supabase.storage.from('Documents').createSignedUrl(storedUrl, 3600)
    return data?.signedUrl || ''
  }

  async function fetchMessages() {
    setMsgLoading(true)
    // No user_id filter — RLS policy scopes to family via family_name
    const { data } = await supabase
      .from('family_messages')
      .select('*')
      .order('created_at', { ascending: false })
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

  function authorName() {
    return user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'Family'
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
      family_name: user.user_metadata?.family_name || '',
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
      family_name: user.user_metadata?.family_name || '',
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
      } catch (_) {}
    }
    if (storagePath) await supabase.storage.from('Documents').remove([storagePath])
    await supabase.from('family_photos').delete().eq('id', photo.id)
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    if (selectedPhoto?.id === photo.id) setSelectedPhoto(null)
  }

  function formatTs(ts) {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  if (subscriptionTier === 'free') {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <Users size={20} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Family Hub</h1>
              <p className="text-white/60 text-sm">Messages &amp; Photos</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center gap-5">
          <div className="bg-[#1B365D] rounded-2xl p-5">
            <Lock size={40} color="#D4A843" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-[#1B365D] text-xl font-bold mb-2">Premium Feature</h2>
            <p className="text-gray-500 text-base leading-relaxed max-w-xs">
              Family messages and photo sharing are available on SeniorSafe Premium. Stay connected with your whole family.
            </p>
          </div>
          <a href="sms:3365538933" className="w-full max-w-xs py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg text-center block">
            Text Ryan to Upgrade
          </a>
          <p className="text-gray-400 text-sm">(336) 553-8933 · $14.99/month</p>
          <button onClick={() => navigate('/dashboard')} className="text-[#1B365D] text-sm underline">
            ← Back to Dashboard
          </button>
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col pb-20">
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
              <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Family Hub</h1>
              <p className="text-white/60 text-sm">Messages &amp; Photos</p>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1">
            {['messages', 'photos'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-sm font-semibold capitalize rounded-t-xl transition-colors ${
                  tab === t ? 'bg-[#F5F5F5] text-[#1B365D]' : 'text-white/60'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── MESSAGES TAB ── */}
      {tab === 'messages' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="max-w-lg mx-auto flex flex-col gap-3">
              {msgLoading ? (
                <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center py-20 text-center gap-3">
                  <div className="bg-gray-100 rounded-2xl p-5">
                    <Users size={44} color="#9CA3AF" strokeWidth={1.5} />
                  </div>
                  <p className="text-gray-600 font-semibold" style={{ fontSize: '17px' }}>
                    Be the first to post a message!
                  </p>
                  <p className="text-gray-400" style={{ fontSize: '15px' }}>
                    Share updates, encouragement, and news with your family.
                  </p>
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className="bg-white rounded-2xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#1B365D] flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">
                            {msg.author_name?.[0]?.toUpperCase() || 'F'}
                          </span>
                        </div>
                        <div>
                          <p className="text-[#1B365D] font-semibold text-sm">{msg.author_name}</p>
                          <p className="text-gray-400 text-xs">{formatTs(msg.created_at)}</p>
                        </div>
                      </div>
                      {msg.user_id === user?.id && (
                        <button onClick={() => deleteMessage(msg.id)} className="p-1 text-gray-300 hover:text-red-500 flex-shrink-0">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    {msg.message_text && (
                      <p className="mt-3 text-gray-700 leading-relaxed" style={{ fontSize: '16px' }}>
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
                ))
              )}
            </div>
          </div>

          {/* Post message form — paid only */}
          {subscriptionTier === 'paid' ? (
            <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3">
              <div className="max-w-lg mx-auto">
                {msgPhoto && (
                  <div className="relative w-20 h-20 mb-2">
                    <img src={msgPhoto.previewUrl} alt="preview" className="w-full h-full object-cover rounded-xl" />
                    <button
                      onClick={() => { URL.revokeObjectURL(msgPhoto.previewUrl); setMsgPhoto(null) }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-600 rounded-full flex items-center justify-center"
                    >
                      <X size={10} color="white" />
                    </button>
                  </div>
                )}
                <form onSubmit={postMessage} className="flex gap-2 items-end">
                  <button
                    type="button"
                    onClick={() => msgPhotoRef.current?.click()}
                    className="flex-shrink-0 w-11 h-11 rounded-2xl bg-[#F5F5F5] flex items-center justify-center"
                  >
                    <ImagePlus size={20} color="#1B365D" strokeWidth={1.5} />
                  </button>
                  <textarea
                    value={newMsg}
                    onChange={e => setNewMsg(e.target.value)}
                    placeholder="Write a message to your family..."
                    rows={1}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-2xl resize-none focus:outline-none focus:border-[#1B365D]"
                    style={{ fontSize: '16px', maxHeight: '100px' }}
                  />
                  <button
                    type="submit"
                    disabled={posting || (!newMsg.trim() && !msgPhoto)}
                    className="flex-shrink-0 w-11 h-11 rounded-2xl bg-[#1B365D] flex items-center justify-center disabled:opacity-40"
                  >
                    <Send size={18} color="#D4A843" strokeWidth={2} />
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex-shrink-0 bg-gray-50 border-t border-gray-200 px-4 py-3">
              <p className="text-center text-sm text-gray-400 max-w-lg mx-auto">
                <Lock size={12} className="inline mr-1" />
                View only — <a href="sms:3365538933" className="text-[#1B365D] underline">upgrade to Premium</a> to post messages
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── PHOTOS TAB ── */}
      {tab === 'photos' && (
        <div className="flex-1 overflow-y-auto">
          {subscriptionTier !== 'paid' ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center gap-5">
              <div className="bg-[#1B365D] rounded-2xl p-5">
                <Lock size={40} color="#D4A843" strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-[#1B365D] text-xl font-bold mb-2">Premium Feature</h2>
                <p className="text-gray-500 text-base leading-relaxed max-w-xs">
                  Family photo sharing is available on SeniorSafe Premium.
                </p>
              </div>
              <a href="sms:3365538933" className="w-full max-w-xs py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg text-center block">
                Text Ryan to Upgrade
              </a>
              <p className="text-gray-400 text-sm">(336) 553-8933 · $14.99/month</p>
            </div>
          ) : (
          <div className="max-w-lg mx-auto px-4 py-4">
            {/* Upload button */}
            <button
              onClick={() => photoUploadRef.current?.click()}
              disabled={uploading}
              className="w-full py-4 rounded-xl border-2 border-dashed border-[#1B365D] flex items-center justify-center gap-2 text-[#1B365D] font-semibold mb-4 disabled:opacity-60"
              style={{ fontSize: '16px' }}
            >
              <ImagePlus size={20} strokeWidth={1.5} />
              {uploading ? 'Uploading...' : 'Upload Photo'}
            </button>

            {photoLoading ? (
              <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
            ) : photos.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center gap-3">
                <div className="bg-gray-100 rounded-2xl p-5">
                  <ImagePlus size={44} color="#9CA3AF" strokeWidth={1.5} />
                </div>
                <p className="text-gray-600 font-semibold" style={{ fontSize: '17px' }}>No photos yet.</p>
                <p className="text-gray-400" style={{ fontSize: '15px' }}>Upload your first family photo.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map(photo => (
                  <div
                    key={photo.id}
                    className="relative aspect-square rounded-xl overflow-hidden bg-gray-100"
                    onClick={() => setSelectedPhoto(photo)}
                  >
                    <img src={photo.photo_url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
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

      <BottomNav />
    </div>
  )
}
