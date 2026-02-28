import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Pill, X, Check, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'

const FREQUENCIES = ['Once daily', 'Twice daily', 'Three times daily', 'As needed']

const DEFAULT_TIMES = {
  'Once daily':        ['08:00'],
  'Twice daily':       ['08:00', '20:00'],
  'Three times daily': ['08:00', '13:00', '20:00'],
  'As needed':         [],
}

function fmt12(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function todayStr() { return new Date().toISOString().split('T')[0] }

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function timeToMinutes(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function getDoseStatus(time, logs) {
  const taken = logs.some(l => l.scheduled_time === time)
  if (taken) return 'taken'
  if (timeToMinutes(time) < nowMinutes()) return 'overdue'
  return 'upcoming'
}

const STATUS_STYLES = {
  taken:    'bg-green-50  border-green-200',
  overdue:  'bg-red-50    border-red-200',
  upcoming: 'bg-white     border-gray-200',
}

export default function MedicationsPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [subscriptionTier, setSubscriptionTier] = useState(null)
  const [medications, setMedications] = useState([])
  const [todayLogs, setTodayLogs] = useState([])   // { id, medication_id, scheduled_time }
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(null)   // dose key being toggled
  const [userPhone, setUserPhone] = useState('')
  const [form, setForm] = useState({
    med_name: '', dosage: '', frequency: 'Once daily', times: ['08:00'],
    reminder_enabled: false, reminder_phone: '',
  })

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      fetchAll(user.id)
      // Fetch user's phone + subscription tier
      supabase.from('user_profile').select('phone, subscription_tier').eq('user_id', user.id).single()
        .then(({ data }) => {
          const phone = data?.phone || user.user_metadata?.phone || ''
          setUserPhone(phone)
          setSubscriptionTier(data?.subscription_tier || 'paid')
        })
    })
  }, [])

  async function fetchAll(uid) {
    setLoading(true)
    const [{ data: meds }, { data: logs }] = await Promise.all([
      supabase.from('medications').select('*').eq('user_id', uid).eq('active', true).order('created_at'),
      supabase.from('med_logs').select('id, medication_id, scheduled_time').eq('user_id', uid).eq('date', todayStr()),
    ])
    setMedications(meds || [])
    setTodayLogs(logs || [])
    setLoading(false)
  }

  function handleFreqChange(freq) {
    setForm(f => ({ ...f, frequency: freq, times: [...DEFAULT_TIMES[freq]] }))
  }

  function setTimeAt(i, val) {
    setForm(f => {
      const times = [...f.times]
      times[i] = val
      return { ...f, times }
    })
  }

  async function handleAddMed(e) {
    e.preventDefault()
    if (!form.med_name.trim() || !user) return
    setSaving(true)
    const { error } = await supabase.from('medications').insert({
      user_id: user.id,
      family_name: user.user_metadata?.family_name || '',
      med_name: form.med_name.trim(),
      dosage: form.dosage.trim(),
      frequency: form.frequency,
      times: form.times,
      active: true,
      reminder_enabled: form.reminder_enabled,
      reminder_phone: form.reminder_phone.trim(),
    })
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    setShowForm(false)
    setForm({ med_name: '', dosage: '', frequency: 'Once daily', times: ['08:00'], reminder_enabled: false, reminder_phone: '' })
    fetchAll(user.id)
  }

  async function toggleDose(med, time) {
    const key = `${med.id}-${time}`
    if (toggling === key) return
    setToggling(key)
    const existing = todayLogs.find(l => l.medication_id === med.id && l.scheduled_time === time)
    if (existing) {
      await supabase.from('med_logs').delete().eq('id', existing.id)
      setTodayLogs(prev => prev.filter(l => l.id !== existing.id))
    } else {
      const { data } = await supabase.from('med_logs').insert({
        user_id: user.id,
        medication_id: med.id,
        taken_at: new Date().toISOString(),
        scheduled_time: time,
        date: todayStr(),
      }).select().single()
      if (data) setTodayLogs(prev => [...prev, data])
    }
    setToggling(null)
  }

  async function deleteMed(id) {
    if (!window.confirm('Remove this medication?')) return
    await supabase.from('medications').update({ active: false }).eq('id', id)
    setMedications(prev => prev.filter(m => m.id !== id))
  }

  const medsLogs = todayLogs.filter(l => true)

  if (subscriptionTier === 'free') {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
          <div className="max-w-lg mx-auto">
            <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-white/70 text-sm mb-4">
              <ArrowLeft size={16} /> Back
            </button>
            <div className="flex items-center gap-3">
              <div className="bg-white/15 rounded-xl p-2">
                <Pill size={20} color="#D4A843" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Medications</h1>
                <p className="text-white/60 text-sm">Daily checklist</p>
              </div>
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
              Medication tracking and SMS reminders are available on SeniorSafe Premium.
            </p>
          </div>
          <a href="sms:3365538933" className="w-full max-w-xs py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg text-center block">
            Text Ryan to Upgrade
          </a>
          <p className="text-gray-400 text-sm">(336) 553-8933 · $12–25/month</p>
          <button onClick={() => navigate('/dashboard')} className="text-[#1B365D] text-sm underline">
            ← Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-white/70 text-sm mb-4">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/15 rounded-xl p-2">
                <Pill size={20} color="#D4A843" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Medications</h1>
                <p className="text-white/60 text-sm">Daily checklist</p>
              </div>
            </div>
            <button
              onClick={() => {
                setForm(f => ({ ...f, reminder_phone: f.reminder_phone || userPhone }))
                setShowForm(true)
              }}
              className="w-10 h-10 rounded-xl bg-[#D4A843] flex items-center justify-center"
            >
              <Plus size={22} color="#1B365D" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {/* Medication list */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-lg mx-auto flex flex-col gap-4">
          {loading ? (
            <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
          ) : medications.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center gap-4">
              <div className="bg-gray-100 rounded-2xl p-5">
                <Pill size={44} color="#9CA3AF" strokeWidth={1.5} />
              </div>
              <p className="text-gray-600 font-semibold" style={{ fontSize: '17px' }}>No medications added yet.</p>
              <p className="text-gray-400" style={{ fontSize: '15px' }}>Tap + to add your first medication.</p>
            </div>
          ) : (
            medications.map(med => {
              const medLogs = medsLogs.filter(l => l.medication_id === med.id)
              return (
                <div key={med.id} className="bg-white rounded-2xl overflow-hidden shadow-sm">
                  {/* Med header */}
                  <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
                    <div>
                      <p className="text-[#1B365D] font-bold" style={{ fontSize: '17px' }}>{med.med_name}</p>
                      <p className="text-gray-500 text-sm">
                        {med.dosage && `${med.dosage} · `}{med.frequency}
                      </p>
                    </div>
                    <button onClick={() => deleteMed(med.id)} className="p-2 text-gray-300 hover:text-red-500">
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {/* Dose checkboxes */}
                  {med.frequency === 'As needed' ? (
                    <div className="px-4 py-3">
                      <p className="text-gray-400 text-sm italic">Take as needed</p>
                    </div>
                  ) : (
                    med.times?.map((time, i) => {
                      const status = getDoseStatus(time, medLogs)
                      const key = `${med.id}-${time}`
                      return (
                        <button
                          key={i}
                          onClick={() => toggleDose(med, time)}
                          disabled={toggling === key}
                          className={`w-full flex items-center gap-4 px-4 py-3.5 border-b last:border-b-0 border-gray-50 transition-colors ${STATUS_STYLES[status]}`}
                        >
                          {/* Checkbox */}
                          <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center flex-shrink-0 ${
                            status === 'taken'
                              ? 'bg-green-500 border-green-500'
                              : status === 'overdue'
                              ? 'border-red-300 bg-white'
                              : 'border-gray-300 bg-white'
                          }`}>
                            {status === 'taken' && <Check size={16} color="white" strokeWidth={2.5} />}
                          </div>
                          <span className={`flex-1 text-left font-medium ${
                            status === 'taken' ? 'line-through text-gray-400' : 'text-gray-700'
                          }`} style={{ fontSize: '16px' }}>
                            {fmt12(time)}
                          </span>
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                            status === 'taken'   ? 'bg-green-100 text-green-700' :
                            status === 'overdue' ? 'bg-red-100 text-red-600'    :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {status === 'taken' ? 'Taken' : status === 'overdue' ? 'Overdue' : 'Upcoming'}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Add medication modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center sm:items-center"
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}
        >
          <form
            onSubmit={handleAddMed}
            className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[#1B365D] font-bold" style={{ fontSize: '20px' }}>Add Medication</h2>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 text-gray-400">
                <X size={22} />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Medication name *</label>
              <input
                required
                value={form.med_name}
                onChange={e => setForm(f => ({ ...f, med_name: e.target.value }))}
                placeholder="e.g. Lisinopril"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dosage</label>
              <input
                value={form.dosage}
                onChange={e => setForm(f => ({ ...f, dosage: e.target.value }))}
                placeholder="e.g. 10mg"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
              <select
                value={form.frequency}
                onChange={e => handleFreqChange(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
              >
                {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>

            {form.times.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Time(s) to take</label>
                <div className="flex flex-col gap-2">
                  {form.times.map((t, i) => (
                    <input
                      key={i}
                      type="time"
                      value={t}
                      onChange={e => setTimeAt(i, e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                      style={{ fontSize: '16px' }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Reminder toggle */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-gray-700">Remind me by text</p>
                  <p className="text-xs text-gray-400 mt-0.5">Send an SMS when it's time to take this</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, reminder_enabled: !f.reminder_enabled }))}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                    form.reminder_enabled ? 'bg-[#1B365D]' : 'bg-gray-300'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    form.reminder_enabled ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {form.reminder_enabled && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone number for reminders</label>
                  <input
                    type="tel"
                    value={form.reminder_phone}
                    onChange={e => setForm(f => ({ ...f, reminder_phone: e.target.value }))}
                    placeholder="(336) 555-0100"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                    style={{ fontSize: '16px' }}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving || !form.med_name.trim()}
              className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold disabled:opacity-50"
              style={{ fontSize: '17px' }}
            >
              {saving ? 'Saving...' : 'Add Medication'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
