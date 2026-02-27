import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Settings, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ProfilePage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    sms_notifications: true,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      supabase.from('user_profile').select('*').eq('user_id', user.id).single()
        .then(({ data }) => {
          setForm({
            first_name: data?.first_name || user.user_metadata?.first_name || '',
            last_name: data?.last_name || user.user_metadata?.last_name || '',
            phone: data?.phone || user.user_metadata?.phone || '',
            sms_notifications: data?.sms_notifications !== false,
          })
          setLoading(false)
        })
    })
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    if (!user) return
    setSaving(true)

    const [profileResult] = await Promise.all([
      supabase.from('user_profile').update({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || null,
        sms_notifications: form.sms_notifications,
      }).eq('user_id', user.id),

      supabase.auth.updateUser({
        data: {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim(),
        },
      }),
    ])

    setSaving(false)
    if (profileResult.error) {
      alert('Error saving: ' + profileResult.error.message)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col pb-8">
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-white/70 text-sm mb-4">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <Settings size={20} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Profile &amp; Settings</h1>
              <p className="text-white/60 text-sm">Manage your account preferences</p>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
      ) : (
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-4 py-5">
          <div className="max-w-lg mx-auto flex flex-col gap-5">

            {/* Profile */}
            <div className="bg-white rounded-2xl px-4 py-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-4">Your Profile</p>
              <div className="flex flex-col gap-4">

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                    <input
                      type="text"
                      value={form.first_name}
                      onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                      placeholder="Jane"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                      style={{ fontSize: '16px' }}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                    <input
                      type="text"
                      value={form.last_name}
                      onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                      placeholder="Smith"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                      style={{ fontSize: '16px' }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mobile phone number</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="(336) 555-0100"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                    style={{ fontSize: '16px' }}
                  />
                  <p className="text-gray-400 text-xs mt-1.5">
                    Used for "I'm Okay" check-in alerts and medication reminders
                  </p>
                </div>

              </div>
            </div>

            {/* SMS Notifications */}
            <div className="bg-white rounded-2xl px-4 py-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-4">SMS Notifications</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Receive SMS notifications</p>
                  <p className="text-xs text-gray-400 mt-0.5">Check-in alerts, reminders, and family updates</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, sms_notifications: !f.sms_notifications }))}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${
                    form.sms_notifications ? 'bg-[#1B365D]' : 'bg-gray-300'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    form.sms_notifications ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            {/* Account info */}
            <div className="bg-white rounded-2xl px-4 py-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">Account</p>
              <p className="text-gray-700 text-sm">
                <span className="text-gray-500">Email: </span>{user?.email}
              </p>
            </div>

            <button
              type="submit"
              disabled={saving}
              className={`w-full py-4 rounded-xl font-semibold text-lg disabled:opacity-50 transition-colors ${
                saved ? 'bg-green-500 text-white' : 'bg-[#1B365D] text-[#D4A843]'
              }`}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Changes'}
            </button>

          </div>
        </form>
      )}
    </div>
  )
}
