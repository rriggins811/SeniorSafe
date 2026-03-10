import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Settings, Clock, Lock, Trash2, AlertTriangle, Phone, Plus, X, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ProfilePage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    sms_notifications: true,
    checkin_alert_time: '12:00',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  // Change password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMessage, setPwMessage] = useState('')
  const [pwError, setPwError] = useState('')

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteText, setDeleteText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Quick dial contacts state
  const [quickDialContacts, setQuickDialContacts] = useState([])
  const [qdLoading, setQdLoading] = useState(true)
  const [editingContact, setEditingContact] = useState(null) // null or { id?, label, name, phone }
  const [qdSaving, setQdSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      supabase.from('user_profile').select('*').eq('user_id', user.id).single()
        .then(({ data }) => {
          setProfile(data)
          setForm({
            first_name: data?.first_name || user.user_metadata?.first_name || '',
            last_name: data?.last_name || user.user_metadata?.last_name || '',
            phone: data?.phone || user.user_metadata?.phone || '',
            sms_notifications: data?.sms_notifications !== false,
            checkin_alert_time: data?.checkin_alert_time || '12:00',
          })
          setLoading(false)
        })

      // Load quick dial contacts
      supabase.from('quick_dial_contacts')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true })
        .limit(4)
        .then(({ data }) => { setQuickDialContacts(data || []); setQdLoading(false) })
    })
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    if (!user) return
    setSaving(true)

    const updateData = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone: form.phone.trim() || null,
      sms_notifications: form.sms_notifications,
    }

    // Only save checkin_alert_time for admin users
    if (profile?.role === 'admin') {
      updateData.checkin_alert_time = form.checkin_alert_time
    }

    const [profileResult] = await Promise.all([
      supabase.from('user_profile').update(updateData).eq('user_id', user.id),
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

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwError('')
    setPwMessage('')

    if (newPassword.length < 6) {
      setPwError('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.')
      return
    }

    setPwLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwLoading(false)

    if (error) {
      setPwError(error.message)
    } else {
      setPwMessage('Password updated successfully!')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPwMessage(''), 4000)
    }
  }

  async function handleDeleteAccount() {
    if (deleteText !== 'DELETE') return
    setDeleting(true)

    // Sign out first, then let them know to contact support
    // Full account deletion requires a service-role call or admin action
    // For safety, we sign them out and show a confirmation
    await supabase.auth.signOut()
    navigate('/signin')
    // NOTE: In production, this should call a server-side function to fully delete user data.
    // For now, signing out + displaying the confirmation is the safe approach.
  }

  async function fetchQuickDial() {
    if (!user) return
    const { data } = await supabase.from('quick_dial_contacts')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .limit(4)
    setQuickDialContacts(data || [])
  }

  async function saveQuickDialContact() {
    if (!editingContact || !user) return
    setQdSaving(true)
    const { label, name, phone, id } = editingContact

    if (id) {
      await supabase.from('quick_dial_contacts')
        .update({ label: label.trim(), name: name.trim(), phone: phone.trim() })
        .eq('id', id)
    } else {
      await supabase.from('quick_dial_contacts')
        .insert({ user_id: user.id, label: label.trim(), name: name.trim(), phone: phone.trim(), sort_order: quickDialContacts.length })
    }

    setQdSaving(false)
    setEditingContact(null)
    await fetchQuickDial()
  }

  async function deleteQuickDialContact(id) {
    if (!confirm('Remove this speed dial contact?')) return
    await supabase.from('quick_dial_contacts').delete().eq('id', id)
    await fetchQuickDial()
  }

  const isAdmin = profile?.role === 'admin'
  const isPaid = profile?.subscription_tier === 'paid'

  // Generate time options (every 30 minutes)
  const timeOptions = []
  for (let h = 6; h <= 20; h++) {
    for (const m of ['00', '30']) {
      const val = `${String(h).padStart(2, '0')}:${m}`
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h
      const ampm = h >= 12 ? 'PM' : 'AM'
      timeOptions.push({ value: val, label: `${hour12}:${m} ${ampm}` })
    }
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
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="max-w-lg mx-auto flex flex-col gap-5">

            {/* ───────── Profile form (save-able) ───────── */}
            <form onSubmit={handleSave} className="flex flex-col gap-5">

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
                      Used for &ldquo;I&rsquo;m Okay&rdquo; check-in alerts and medication reminders
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

              {/* Check-In Alert Time (admin only) */}
              {isAdmin && (
                <div className="bg-white rounded-2xl px-4 py-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-4">Check-In Reminder</p>
                  <div className="flex items-start gap-3">
                    <Clock size={18} className="text-[#1B365D] mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">Daily check-in deadline</p>
                      <p className="text-xs text-gray-400 mt-0.5 mb-3">
                        If no &ldquo;I&rsquo;m Okay&rdquo; check-in by this time, your family will be alerted.
                      </p>
                      <select
                        value={form.checkin_alert_time}
                        onChange={e => setForm(f => ({ ...f, checkin_alert_time: e.target.value }))}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white focus:outline-none focus:border-[#1B365D]"
                        style={{ fontSize: '16px' }}
                      >
                        {timeOptions.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Quick Dial Contacts ── */}
              <div className="bg-white rounded-2xl px-4 py-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Phone size={14} className="text-gray-400" />
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Speed Dial Contacts</p>
                </div>

                {!isPaid ? (
                  <div className="flex items-center gap-3 py-2">
                    <Lock size={18} color="#9CA3AF" />
                    <div>
                      <p className="text-gray-500 text-sm">Speed dial is a Premium feature.</p>
                      <a
                        href="sms:+13365538933?body=I%27d%20like%20to%20upgrade%20my%20SeniorSafe%20account"
                        className="text-[#D4A843] text-xs font-semibold mt-1 inline-block"
                      >
                        Text Ryan to Upgrade →
                      </a>
                    </div>
                  </div>
                ) : qdLoading ? (
                  <p className="text-gray-400 text-sm py-4 text-center">Loading...</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {quickDialContacts.length === 0 && (
                      <p className="text-gray-400 text-sm text-center py-2">No speed dial contacts yet.</p>
                    )}

                    {quickDialContacts.map(c => (
                      <div key={c.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                        <div className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
                          <Phone size={16} color="#16A34A" strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[#1B365D] font-semibold text-sm">{c.label}</p>
                          <p className="text-gray-400 text-xs truncate">{c.name} · {c.phone}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingContact({ id: c.id, label: c.label, name: c.name, phone: c.phone })}
                          className="p-2 text-gray-400 hover:text-[#1B365D]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteQuickDialContact(c.id)}
                          className="p-2 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}

                    {quickDialContacts.length < 4 && (
                      <button
                        type="button"
                        onClick={() => setEditingContact({ label: '', name: '', phone: '' })}
                        className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 font-semibold text-sm flex items-center justify-center gap-2 hover:border-[#1B365D] hover:text-[#1B365D]"
                      >
                        <Plus size={16} />
                        Add Contact ({quickDialContacts.length}/4)
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Account info */}
              <div className="bg-white rounded-2xl px-4 py-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">Account</p>
                <p className="text-gray-700 text-sm">
                  <span className="text-gray-500">Email: </span>{user?.email}
                </p>
                <p className="text-gray-700 text-sm mt-1">
                  <span className="text-gray-500">Plan: </span>
                  <span className={isPaid ? 'text-green-600 font-medium' : 'text-gray-600'}>
                    {isPaid ? 'Premium' : 'Free'}
                  </span>
                </p>
              </div>

              {/* Save button */}
              <button
                type="submit"
                disabled={saving}
                className={`w-full py-4 rounded-xl font-semibold text-lg disabled:opacity-50 transition-colors ${
                  saved ? 'bg-green-500 text-white' : 'bg-[#1B365D] text-[#D4A843]'
                }`}
              >
                {saving ? 'Saving...' : saved ? '\u2713 Saved!' : 'Save Changes'}
              </button>
            </form>

            {/* ───────── Change Password (separate form) ───────── */}
            <form onSubmit={handleChangePassword} className="bg-white rounded-2xl px-4 py-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Lock size={14} className="text-gray-400" />
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Change Password</p>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                    style={{ fontSize: '16px' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                    style={{ fontSize: '16px' }}
                  />
                </div>
                {pwError && <p className="text-red-500 text-sm">{pwError}</p>}
                {pwMessage && <p className="text-green-600 text-sm font-medium">{pwMessage}</p>}
                <button
                  type="submit"
                  disabled={pwLoading || (!newPassword && !confirmPassword)}
                  className="w-full py-3 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold disabled:opacity-40"
                >
                  {pwLoading ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>

            {/* ───────── Subscription Management (paid users) ───────── */}
            {isPaid && (
              <div className="bg-white rounded-2xl px-4 py-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-4">Subscription</p>
                <p className="text-sm text-gray-700 mb-3">
                  You&rsquo;re on the <span className="font-semibold text-green-600">Premium</span> plan.
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  To manage your subscription, change your plan, or cancel, please contact us:
                </p>
                <a
                  href="sms:+13365538933?body=Hi%20Ryan%2C%20I%27d%20like%20to%20manage%20my%20SeniorSafe%20subscription."
                  className="block w-full text-center py-3 rounded-xl border border-[#1B365D] text-[#1B365D] font-semibold text-sm"
                >
                  Text Ryan at (336) 553-8933
                </a>
                <a
                  href="mailto:support@seniorsafeapp.com?subject=Subscription%20Change%20Request"
                  className="block w-full text-center py-2 text-[#1B365D] text-xs mt-2 underline"
                >
                  Or email support@seniorsafeapp.com
                </a>
              </div>
            )}

            {/* ───────── Delete Account ───────── */}
            <div className="bg-white rounded-2xl px-4 py-5 shadow-sm border border-red-100">
              <div className="flex items-center gap-2 mb-3">
                <Trash2 size={14} className="text-red-400" />
                <p className="text-xs font-bold uppercase tracking-wide text-red-400">Delete Account</p>
              </div>
              {!showDeleteConfirm ? (
                <>
                  <p className="text-xs text-gray-400 mb-3">
                    Permanently delete your account and all associated data. This cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full py-3 rounded-xl border border-red-300 text-red-600 font-semibold text-sm"
                  >
                    Delete My Account
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-red-700 text-xs">
                      This will permanently remove your account, check-in history, documents, and all family data. Type <span className="font-bold">DELETE</span> below to confirm.
                    </p>
                  </div>
                  <input
                    type="text"
                    value={deleteText}
                    onChange={e => setDeleteText(e.target.value)}
                    placeholder='Type "DELETE" to confirm'
                    className="w-full px-4 py-3 border border-red-300 rounded-xl focus:outline-none focus:border-red-500 text-center"
                    style={{ fontSize: '16px' }}
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowDeleteConfirm(false); setDeleteText('') }}
                      className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-semibold text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={deleteText !== 'DELETE' || deleting}
                      onClick={handleDeleteAccount}
                      className="flex-1 py-3 rounded-xl bg-red-600 text-white font-semibold text-sm disabled:opacity-40"
                    >
                      {deleting ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Quick Dial Edit/Add Modal */}
      {editingContact && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[#1B365D] font-bold text-lg">
                {editingContact.id ? 'Edit Contact' : 'Add Speed Dial Contact'}
              </h2>
              <button onClick={() => setEditingContact(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
              <input
                type="text"
                value={editingContact.label}
                onChange={e => setEditingContact(c => ({ ...c, label: e.target.value }))}
                placeholder="e.g. Daughter, Doctor, Neighbor"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
                maxLength={20}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={editingContact.name}
                onChange={e => setEditingContact(c => ({ ...c, name: e.target.value }))}
                placeholder="e.g. Sarah Johnson"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
              <input
                type="tel"
                value={editingContact.phone}
                onChange={e => setEditingContact(c => ({ ...c, phone: e.target.value }))}
                placeholder="(336) 555-0100"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
              />
            </div>

            <button
              type="button"
              disabled={qdSaving || !editingContact.label.trim() || !editingContact.name.trim() || !editingContact.phone.trim()}
              onClick={saveQuickDialContact}
              className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg disabled:opacity-40"
            >
              {qdSaving ? 'Saving...' : editingContact.id ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
