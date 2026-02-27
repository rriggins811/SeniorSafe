import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Calendar, X, ChevronDown, ChevronUp, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'

const APPT_TYPES = ['Medical', 'Dental', 'Vision', 'Therapy', 'Other']

const TYPE_COLORS = {
  Medical:  { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  Dental:   { bg: 'bg-teal-100',   text: 'text-teal-700'   },
  Vision:   { bg: 'bg-purple-100', text: 'text-purple-700' },
  Therapy:  { bg: 'bg-orange-100', text: 'text-orange-700' },
  Other:    { bg: 'bg-gray-100',   text: 'text-gray-600'   },
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function todayStr() { return new Date().toISOString().split('T')[0] }

function downloadIcs(appt) {
  const dateBase = appt.appointment_date
  const startTime = appt.appointment_time || '09:00'
  const [sh, sm] = startTime.split(':').map(Number)
  const endH = String(sh + 1).padStart(2, '0')
  const endTime = `${endH}:${String(sm).padStart(2, '0')}`

  const toIcsDate = (d, t) => {
    const dt = new Date(`${d}T${t}:00`)
    return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SeniorSafe//EN',
    'BEGIN:VEVENT',
    `UID:${appt.id}@seniorsafe`,
    `DTSTART:${toIcsDate(dateBase, startTime)}`,
    `DTEND:${toIcsDate(dateBase, endTime)}`,
    `SUMMARY:${appt.title}`,
    appt.provider_name ? `DESCRIPTION:with ${appt.provider_name}` : null,
    appt.location ? `LOCATION:${appt.location}` : null,
    appt.notes ? `COMMENT:${appt.notes.replace(/\n/g, '\\n')}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')

  const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${appt.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

export default function AppointmentsPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [form, setForm] = useState({
    title: '', provider_name: '', appointment_type: 'Medical',
    appointment_date: '', appointment_time: '', location: '', notes: '',
  })

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)
      fetchAppointments(user.id)
    })
  }, [])

  async function fetchAppointments(uid) {
    setLoading(true)
    const { data } = await supabase
      .from('appointments')
      .select('*')
      .eq('user_id', uid)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })
    setAppointments(data || [])
    setLoading(false)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.appointment_date || !user) return
    setSaving(true)
    const { error } = await supabase.from('appointments').insert({
      user_id: user.id,
      family_name: user.user_metadata?.family_name || '',
      title: form.title.trim(),
      provider_name: form.provider_name.trim(),
      appointment_type: form.appointment_type,
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time,
      location: form.location.trim(),
      notes: form.notes.trim(),
    })
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    setShowForm(false)
    setForm({ title: '', provider_name: '', appointment_type: 'Medical', appointment_date: '', appointment_time: '', location: '', notes: '' })
    fetchAppointments(user.id)
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this appointment?')) return
    setDeleting(id)
    await supabase.from('appointments').delete().eq('id', id)
    setAppointments(prev => prev.filter(a => a.id !== id))
    setDeleting(null)
  }

  const today = todayStr()
  const upcoming = appointments.filter(a => a.appointment_date >= today)
  const past = appointments.filter(a => a.appointment_date < today).reverse()

  function ApptCard({ appt }) {
    const isToday = appt.appointment_date === today
    const typeStyle = TYPE_COLORS[appt.appointment_type] || TYPE_COLORS.Other
    return (
      <div className={`bg-white rounded-2xl overflow-hidden shadow-sm ${isToday ? 'ring-2 ring-[#D4A843]' : ''}`}>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {isToday && (
                <span className="text-xs font-bold text-[#D4A843] uppercase tracking-wide">Today</span>
              )}
              <p className="text-[#1B365D] font-bold leading-tight" style={{ fontSize: '17px' }}>
                {appt.title}
              </p>
              {appt.provider_name && (
                <p className="text-gray-500 text-sm mt-0.5">with {appt.provider_name}</p>
              )}
            </div>
            <button
              onClick={() => handleDelete(appt.id)}
              disabled={deleting === appt.id}
              className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"
            >
              <Trash2 size={17} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-gray-700">
              {formatDate(appt.appointment_date)}
            </span>
            {appt.appointment_time && (
              <span className="text-sm text-gray-500">at {formatTime(appt.appointment_time)}</span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeStyle.bg} ${typeStyle.text}`}>
              {appt.appointment_type}
            </span>
            {appt.location && (
              <span className="text-xs text-gray-400">{appt.location}</span>
            )}
          </div>

          {appt.notes && (
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">{appt.notes}</p>
          )}

          <div className="mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={() => downloadIcs(appt)}
              className="flex items-center gap-1.5 text-[#1B365D] text-sm font-medium hover:opacity-70"
            >
              <Download size={14} strokeWidth={2} />
              Add to Calendar
            </button>
          </div>
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
                <Calendar size={20} color="#D4A843" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Appointments</h1>
                <p className="text-white/60 text-sm">Upcoming schedule</p>
              </div>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="w-10 h-10 rounded-xl bg-[#D4A843] flex items-center justify-center"
            >
              <Plus size={22} color="#1B365D" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-lg mx-auto flex flex-col gap-4">
          {loading ? (
            <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
          ) : upcoming.length === 0 && past.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center gap-4">
              <div className="bg-gray-100 rounded-2xl p-5">
                <Calendar size={44} color="#9CA3AF" strokeWidth={1.5} />
              </div>
              <p className="text-gray-600 font-semibold" style={{ fontSize: '17px' }}>No upcoming appointments.</p>
              <p className="text-gray-400" style={{ fontSize: '15px' }}>Tap + to add one.</p>
            </div>
          ) : (
            <>
              {upcoming.length === 0 && (
                <p className="text-center text-gray-400 py-8" style={{ fontSize: '15px' }}>No upcoming appointments.</p>
              )}
              {upcoming.map(a => <ApptCard key={a.id} appt={a} />)}

              {/* Past appointments */}
              {past.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowPast(s => !s)}
                    className="w-full flex items-center justify-between py-3 px-1 text-gray-400"
                  >
                    <span className="text-sm font-semibold uppercase tracking-wide">
                      Past appointments ({past.length})
                    </span>
                    {showPast ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  {showPast && (
                    <div className="flex flex-col gap-3 opacity-60">
                      {past.map(a => <ApptCard key={a.id} appt={a} />)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add appointment modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center sm:items-center overflow-y-auto"
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}
        >
          <form
            onSubmit={handleAdd}
            className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[#1B365D] font-bold" style={{ fontSize: '20px' }}>Add Appointment</h2>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 text-gray-400">
                <X size={22} />
              </button>
            </div>

            {[
              { label: 'Appointment name *', key: 'title', placeholder: 'e.g. Cardiologist Visit', req: true },
              { label: 'Doctor / Provider', key: 'provider_name', placeholder: 'e.g. Dr. Smith' },
              { label: 'Location', key: 'location', placeholder: 'e.g. UNC Hospital, Chapel Hill' },
            ].map(({ label, key, placeholder, req }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input
                  required={req}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                  style={{ fontSize: '16px' }}
                />
              </div>
            ))}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.appointment_type}
                onChange={e => setForm(f => ({ ...f, appointment_type: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white focus:outline-none focus:border-[#1B365D]"
                style={{ fontSize: '16px' }}
              >
                {APPT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  required
                  value={form.appointment_date}
                  onChange={e => setForm(f => ({ ...f, appointment_date: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                  style={{ fontSize: '16px' }}
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                <input
                  type="time"
                  value={form.appointment_time}
                  onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D]"
                  style={{ fontSize: '16px' }}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any special instructions or reminders..."
                rows={2}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D] resize-none"
                style={{ fontSize: '16px' }}
              />
            </div>

            <button
              type="submit"
              disabled={saving || !form.title.trim() || !form.appointment_date}
              className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold disabled:opacity-50"
              style={{ fontSize: '17px' }}
            >
              {saving ? 'Saving...' : 'Add Appointment'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
