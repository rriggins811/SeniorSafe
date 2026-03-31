import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Camera, Trash2, FileText, X, FolderLock, Lock, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import BottomNav from '../components/BottomNav'
import { openExternalLink } from '../lib/platform'

const CATEGORIES = ['Legal', 'Financial', 'Medical', 'Property', 'Personal']
const FILTER_TABS = ['All', ...CATEGORIES]

const CATEGORY_STYLES = {
  Legal:     { bg: 'bg-purple-100', text: 'text-purple-700' },
  Financial: { bg: 'bg-green-100',  text: 'text-green-700'  },
  Medical:   { bg: 'bg-red-100',    text: 'text-red-700'    },
  Property:  { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  Personal:  { bg: 'bg-orange-100', text: 'text-orange-700' },
}

function isImageFile(fileName) {
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName)
}

export default function VaultPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [familyName, setFamilyName] = useState('')
  const [subscriptionTier, setSubscriptionTier] = useState(null)
  const [role, setRole] = useState(null)
  const [vaultShared, setVaultShared] = useState(false)
  const [adminVaultShared, setAdminVaultShared] = useState(null) // for members: admin's vault_shared flag
  const [documents, setDocuments] = useState([])
  const [filter, setFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [togglingShare, setTogglingShare] = useState(false)

  // Modal state
  const [pendingFile, setPendingFile] = useState(null) // { file, previewUrl }
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('Legal')

  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  async function fetchDocuments(targetUserId) {
    setLoading(true)
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', targetUserId)
      .order('uploaded_at', { ascending: false })
    if (!error && data) {
      // Resolve storage paths for each doc (handle legacy full URLs)
      const docsWithPaths = data.map(doc => {
        const storagePath = doc.file_url
        let path = storagePath
        let isLegacyUrl = false
        if (storagePath.startsWith('http')) {
          const marker = '/object/public/Documents/'
          const idx = storagePath.indexOf(marker)
          if (idx !== -1) path = decodeURIComponent(storagePath.slice(idx + marker.length))
          else isLegacyUrl = true
        }
        return { ...doc, storagePath: path, isLegacyUrl }
      })

      // Batch signed URL request (single network call instead of N)
      const pathsToSign = docsWithPaths
        .filter(d => !d.isLegacyUrl)
        .map(d => d.storagePath)

      let signedMap = new Map()
      if (pathsToSign.length) {
        const { data: signedUrls } = await supabase.storage
          .from('Documents')
          .createSignedUrls(pathsToSign, 3600)
        if (signedUrls) {
          signedUrls.forEach(s => {
            if (s.signedUrl) signedMap.set(s.path, s.signedUrl)
          })
        }
      }

      const withUrls = docsWithPaths.map(doc =>
        doc.isLegacyUrl
          ? { ...doc, signedUrl: doc.file_url }
          : { ...doc, signedUrl: signedMap.get(doc.storagePath) || '' }
      )
      setDocuments(withUrls)
    } else {
      setDocuments([])
    }
    setLoading(false)
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user: authUser } }) => {
      setUser(authUser)
      if (!authUser) return

      // Fetch current user's profile
      const { data: profile } = await supabase
        .from('user_profile')
        .select('subscription_tier, role, vault_shared, invited_by, family_name')
        .eq('user_id', authUser.id)
        .single()

      if (!profile) return

      setSubscriptionTier(profile.subscription_tier || 'free')
      setRole(profile.role || 'admin')
      setVaultShared(profile.vault_shared || false)
      if (profile.family_name) setFamilyName(profile.family_name)

      if (profile.role === 'member' && profile.invited_by) {
        // Member: check admin's vault_shared setting and fetch their docs if shared
        const { data: adminProfile } = await supabase
          .from('user_profile')
          .select('vault_shared')
          .eq('user_id', profile.invited_by)
          .single()

        const shared = adminProfile?.vault_shared || false
        setAdminVaultShared(shared)

        if (shared) {
          fetchDocuments(profile.invited_by)
        } else {
          setLoading(false)
        }
      } else {
        // Admin: fetch own documents
        fetchDocuments(authUser.id)
      }
    })
  }, [])

  async function toggleVaultSharing() {
    if (!user) return
    setTogglingShare(true)
    const newValue = !vaultShared
    const { error } = await supabase
      .from('user_profile')
      .update({ vault_shared: newValue })
      .eq('user_id', user.id)
    if (!error) {
      setVaultShared(newValue)
    }
    setTogglingShare(false)
  }

  function openFilePicker(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    const defaultLabel = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
    setPendingFile({ file, previewUrl })
    setLabel(defaultLabel)
    setCategory('Legal')
    e.target.value = ''
  }

  function cancelModal() {
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl)
    setPendingFile(null)
    setLabel('')
  }

  async function handleUploadConfirm() {
    if (!pendingFile || !label.trim() || !user) return
    setUploading(true)

    const { file } = pendingFile
    const ext = file.name.split('.').pop()
    const storagePath = `${user.id}/${Date.now()}.${ext}`

    const { error: storageError } = await supabase.storage
      .from('Documents')
      .upload(storagePath, file)

    if (storageError) {
      alert('Upload failed: ' + storageError.message)
      setUploading(false)
      return
    }

    const { error: dbError } = await supabase.from('documents').insert({
      user_id: user.id,
      family_name: familyName,
      file_name: file.name,
      file_url: storagePath,
      category,
      label: label.trim(),
    })

    setUploading(false)

    if (dbError) {
      alert('Failed to save document info: ' + dbError.message)
    } else {
      cancelModal()
      fetchDocuments(user.id)
    }
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.label}"? This cannot be undone.`)) return
    setDeleting(doc.id)

    // Use stored path directly (or extract from legacy full URL)
    try {
      const path = doc.storagePath || doc.file_url
      if (path && !path.startsWith('http')) {
        await supabase.storage.from('Documents').remove([path])
      } else if (path) {
        const marker = '/object/public/Documents/'
        const idx = path.indexOf(marker)
        if (idx !== -1) {
          await supabase.storage.from('Documents').remove([decodeURIComponent(path.slice(idx + marker.length))])
        }
      }
    } catch { /* ignore storage errors — still delete DB row */ }

    await supabase.from('documents').delete().eq('id', doc.id)
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    setDeleting(null)
  }

  const filtered = filter === 'All'
    ? documents
    : documents.filter(d => d.category === filter)

  const isAdmin = role === 'admin'
  const isMember = role === 'member'

  // Show upgrade prompt for free tier (null = still loading, show nothing yet)
  if (subscriptionTier === 'free') {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <FolderLock size={22} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white text-xl font-bold leading-tight">Family Vault</h1>
              <p className="text-white/60 text-sm">Your important documents</p>
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
              The Family Vault is available on SeniorSafe Premium. Store important documents securely for your whole family.
            </p>
          </div>
          <button onClick={() => navigate('/upgrade')} className="w-full max-w-xs py-4 rounded-xl bg-[#D4A843] text-[#1B365D] font-semibold text-lg">
            Upgrade to Premium
          </button>
          <p className="text-gray-400 text-sm">Starting at $11.99/month</p>
          <button onClick={() => navigate('/dashboard')} className="text-[#1B365D] text-sm underline">
            ← Back to Dashboard
          </button>
        </div>
        <BottomNav />
      </div>
    )
  }

  // Member view: admin hasn't shared vault
  if (isMember && adminVaultShared === false) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <FolderLock size={22} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white text-xl font-bold leading-tight">Family Vault</h1>
              <p className="text-white/60 text-sm">Shared family documents</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center gap-5">
          <div className="bg-gray-200 rounded-2xl p-5">
            <EyeOff size={40} color="#9CA3AF" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-[#1B365D] text-xl font-bold mb-2">Vault Not Shared Yet</h2>
            <p className="text-gray-500 text-base leading-relaxed max-w-xs">
              Your family member hasn&apos;t shared their vault yet. Once they turn on vault sharing, you&apos;ll be able to view their documents here.
            </p>
          </div>
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
      {/* Hidden file inputs — admin only */}
      {isAdmin && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={openFilePicker}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={openFilePicker}
            className="hidden"
          />
        </>
      )}

      {/* Header */}
      <div className="bg-[#1B365D] px-6 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <FolderLock size={22} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white text-xl font-bold leading-tight">Family Vault</h1>
              <p className="text-white/60 text-sm">
                {isMember ? 'Shared family documents' : 'Your important documents'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Vault sharing toggle — admin only */}
      {isAdmin && (
        <div className="px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              {vaultShared
                ? <Eye size={20} className="text-[#D4A843] shrink-0" />
                : <EyeOff size={20} className="text-gray-400 shrink-0" />
              }
              <div>
                <p className="text-[#1B365D] text-sm font-semibold leading-tight">Share my vault with family</p>
                <p className="text-gray-400 text-xs mt-0.5">Allow family members to view your documents</p>
              </div>
            </div>
            <button
              onClick={toggleVaultSharing}
              disabled={togglingShare}
              className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
                vaultShared ? 'bg-[#D4A843]' : 'bg-gray-300'
              } disabled:opacity-50`}
              aria-label={vaultShared ? 'Disable vault sharing' : 'Enable vault sharing'}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${
                  vaultShared ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {/* Member read-only banner */}
      {isMember && (
        <div className="px-4 py-2 bg-[#D4A843]/10 border-b border-[#D4A843]/20 flex-shrink-0">
          <div className="max-w-lg mx-auto flex items-center gap-2">
            <Eye size={14} className="text-[#D4A843] shrink-0" />
            <p className="text-[#1B365D] text-xs font-medium">View only — shared by your family admin</p>
          </div>
        </div>
      )}

      {/* Upload buttons — admin only */}
      {isAdmin && (
        <div className="px-4 py-4 bg-white border-b border-gray-200 flex-shrink-0">
          <div className="max-w-lg mx-auto flex gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-[#1B365D] text-white font-semibold text-base"
            >
              <Upload size={20} />
              Upload File
            </button>
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-base bg-white"
            >
              <Camera size={20} />
              Take Photo
            </button>
          </div>
        </div>
      )}

      {/* Category filter tabs */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200">
        <div className="max-w-lg mx-auto flex overflow-x-auto no-scrollbar">
          {FILTER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                filter === tab
                  ? 'border-[#1B365D] text-[#1B365D]'
                  : 'border-transparent text-gray-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-lg mx-auto flex flex-col gap-3">
          {loading ? (
            <p className="text-center text-gray-400 py-16 text-base">Loading...</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="bg-gray-200 rounded-2xl p-5 mb-4">
                <FolderLock size={44} color="#9CA3AF" strokeWidth={1.5} />
              </div>
              <p className="text-gray-600 text-base font-medium">No documents yet.</p>
              <p className="text-gray-400 text-sm mt-1 leading-relaxed">
                {isAdmin
                  ? <>Tap <strong>Upload File</strong> or <strong>Take Photo</strong> to get started.</>
                  : 'No shared documents to show yet.'
                }
              </p>
            </div>
          ) : (
            filtered.map(doc => {
              const catStyle = CATEGORY_STYLES[doc.category] || { bg: 'bg-gray-100', text: 'text-gray-600' }
              const isImg = isImageFile(doc.file_name)
              return (
                <div key={doc.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
                  {/* Thumbnail */}
                  <button
                    onClick={() => openExternalLink(doc.signedUrl)}
                    className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center"
                  >
                    {isImg ? (
                      <img src={doc.signedUrl} alt={doc.label} className="w-full h-full object-cover" />
                    ) : (
                      <FileText size={28} color="#9CA3AF" strokeWidth={1.5} />
                    )}
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[#1B365D] font-semibold text-base leading-tight truncate">{doc.label}</p>
                    <p className="text-gray-400 text-sm mt-0.5">
                      {new Date(doc.uploaded_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </p>
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mt-1 ${catStyle.bg} ${catStyle.text}`}>
                      {doc.category}
                    </span>
                  </div>

                  {/* Delete — admin/owner only */}
                  {isAdmin && (
                    <button
                      onClick={() => handleDelete(doc)}
                      disabled={deleting === doc.id}
                      className="p-2.5 text-gray-300 hover:text-red-500 flex-shrink-0 disabled:opacity-40"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Upload modal — admin only */}
      {isAdmin && pendingFile && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center sm:items-center"
          onClick={e => { if (e.target === e.currentTarget) cancelModal() }}
        >
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[#1B365D] text-xl font-bold">What is this document?</h2>
              <button onClick={cancelModal} className="p-2 text-gray-400 hover:text-gray-600">
                <X size={22} />
              </button>
            </div>

            {/* Image preview */}
            {pendingFile.previewUrl && (
              <img
                src={pendingFile.previewUrl}
                alt="preview"
                className="w-full h-44 object-cover rounded-xl bg-gray-100"
              />
            )}

            {!pendingFile.previewUrl && (
              <div className="w-full h-20 rounded-xl bg-gray-100 flex items-center justify-center gap-2 text-gray-400">
                <FileText size={28} strokeWidth={1.5} />
                <span className="text-sm">{pendingFile.file.name}</span>
              </div>
            )}

            {/* Label */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Document name / label
              </label>
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Dad's Power of Attorney"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
                autoFocus
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <button
              onClick={handleUploadConfirm}
              disabled={uploading || !label.trim()}
              className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Save Document'}
            </button>
          </div>
        </div>
      )}
      <BottomNav />
    </div>
  )
}
