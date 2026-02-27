import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, Camera, Trash2, FileText, X, FolderLock } from 'lucide-react'
import { supabase } from '../lib/supabase'

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
  const [documents, setDocuments] = useState([])
  const [filter, setFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(null)

  // Modal state
  const [pendingFile, setPendingFile] = useState(null) // { file, previewUrl }
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('Legal')

  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      if (user) fetchDocuments(user.id)
    })
  }, [])

  async function fetchDocuments(userId) {
    setLoading(true)
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false })
    if (!error) setDocuments(data || [])
    setLoading(false)
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
      .from('documents')
      .upload(storagePath, file)

    if (storageError) {
      alert('Upload failed: ' + storageError.message)
      setUploading(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath)

    const { error: dbError } = await supabase.from('documents').insert({
      user_id: user.id,
      family_name: user.user_metadata?.family_name || '',
      file_name: file.name,
      file_url: publicUrl,
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

    // Extract storage path from public URL
    try {
      const url = new URL(doc.file_url)
      const marker = '/object/public/documents/'
      const idx = url.pathname.indexOf(marker)
      if (idx !== -1) {
        const storagePath = decodeURIComponent(url.pathname.slice(idx + marker.length))
        await supabase.storage.from('documents').remove([storagePath])
      }
    } catch (_) { /* ignore storage path errors — still delete DB row */ }

    await supabase.from('documents').delete().eq('id', doc.id)
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    setDeleting(null)
  }

  const filtered = filter === 'All'
    ? documents
    : documents.filter(d => d.category === filter)

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Hidden file inputs */}
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
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <FolderLock size={22} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white text-xl font-bold leading-tight">Family Vault</h1>
              <p className="text-white/60 text-sm">Your important documents</p>
            </div>
          </div>
        </div>
      </div>

      {/* Upload buttons */}
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
                Tap <strong>Upload File</strong> or <strong>Take Photo</strong> to get started.
              </p>
            </div>
          ) : (
            filtered.map(doc => {
              const catStyle = CATEGORY_STYLES[doc.category] || { bg: 'bg-gray-100', text: 'text-gray-600' }
              const isImg = isImageFile(doc.file_name)
              return (
                <div key={doc.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
                  {/* Thumbnail */}
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center"
                  >
                    {isImg ? (
                      <img src={doc.file_url} alt={doc.label} className="w-full h-full object-cover" />
                    ) : (
                      <FileText size={28} color="#9CA3AF" strokeWidth={1.5} />
                    )}
                  </a>

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

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(doc)}
                    disabled={deleting === doc.id}
                    className="p-2.5 text-gray-300 hover:text-red-500 flex-shrink-0 disabled:opacity-40"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Upload modal */}
      {pendingFile && (
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
    </div>
  )
}
