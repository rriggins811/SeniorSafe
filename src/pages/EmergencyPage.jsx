import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Heart, Edit2, Save } from 'lucide-react'
import { supabase } from '../lib/supabase'

const BLOOD_TYPES = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

const EMPTY = {
  full_name: '', date_of_birth: '', blood_type: 'Unknown',
  allergies: '', current_meds_summary: '',
  primary_doctor_name: '', primary_doctor_phone: '',
  ec1_name: '', ec1_relationship: '', ec1_phone: '',
  ec2_name: '', ec2_relationship: '', ec2_phone: '',
  insurance_company: '', policy_number: '',
  special_instructions: '',
}

function Field({ label, value }) {
  if (!value) return null
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
      <p className="text-gray-800 leading-relaxed" style={{ fontSize: '16px' }}>{value}</p>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl px-4 shadow-sm overflow-hidden">
      <p className="text-[#1B365D] font-bold text-sm uppercase tracking-wide py-3 border-b border-gray-100">
        {title}
      </p>
      {children}
    </div>
  )
}

export default function EmergencyPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [info, setInfo] = useState(EMPTY)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasRecord, setHasRecord] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUser(user)

      // Fetch existing emergency info
      supabase.from('emergency_info').select('*').eq('user_id', user.id).single()
        .then(({ data }) => {
          if (data) {
            const d = { ...EMPTY, ...data }
            setInfo(d)
            setDraft(d)
            setHasRecord(true)
          } else {
            setEditMode(true) // No record yet — open in edit mode automatically
          }
          setLoading(false)
        })

      // Auto-populate medications summary if empty
      supabase.from('medications').select('med_name, dosage').eq('user_id', user.id).eq('active', true)
        .then(({ data: meds }) => {
          if (meds?.length) {
            const summary = meds.map(m => m.dosage ? `${m.med_name} ${m.dosage}` : m.med_name).join(', ')
            setInfo(prev => ({ ...prev, current_meds_summary: prev.current_meds_summary || summary }))
            setDraft(prev => ({ ...prev, current_meds_summary: prev.current_meds_summary || summary }))
          }
        })
    })
  }, [])

  function set(key, val) { setDraft(d => ({ ...d, [key]: val })) }

  async function handleSave() {
    if (!user) return
    setSaving(true)
    const payload = { ...draft, user_id: user.id, family_name: user.user_metadata?.family_name || '' }
    const { error } = hasRecord
      ? await supabase.from('emergency_info').update(payload).eq('user_id', user.id)
      : await supabase.from('emergency_info').insert(payload)
    setSaving(false)
    if (error) { alert('Error saving: ' + error.message); return }
    setInfo(draft)
    setHasRecord(true)
    setEditMode(false)
  }

  const inp = (key, opts = {}) => (
    <input
      value={draft[key]}
      onChange={e => set(key, e.target.value)}
      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D] bg-white"
      style={{ fontSize: '16px' }}
      {...opts}
    />
  )

  const ta = (key, rows = 3) => (
    <textarea
      value={draft[key]}
      onChange={e => set(key, e.target.value)}
      rows={rows}
      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-[#1B365D] resize-none bg-white"
      style={{ fontSize: '16px' }}
    />
  )

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Header */}
      <div className="bg-red-600 px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-white/80 text-sm mb-4">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-xl p-2">
                <Heart size={20} color="white" strokeWidth={0} fill="white" />
              </div>
              <div>
                <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Emergency Info</h1>
                <p className="text-white/70 text-sm">For first responders</p>
              </div>
            </div>
            {!editMode ? (
              <button
                onClick={() => { setDraft({ ...info }); setEditMode(true) }}
                className="flex items-center gap-1.5 bg-white/20 text-white text-sm font-semibold px-4 py-2 rounded-xl"
              >
                <Edit2 size={15} /> Edit
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 bg-white text-red-600 text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-60"
              >
                <Save size={15} /> {saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-16" style={{ fontSize: '16px' }}>Loading...</p>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="max-w-lg mx-auto flex flex-col gap-4">

            {editMode ? (
              /* ── EDIT MODE ── */
              <>
                <Section title="Personal Information">
                  <div className="flex flex-col gap-3 py-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Full legal name</label>
                      {inp('full_name', { placeholder: 'Margaret Anne Johnson' })}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth</label>
                      {inp('date_of_birth', { type: 'date' })}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Blood type</label>
                      <select
                        value={draft.blood_type}
                        onChange={e => set('blood_type', e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white focus:outline-none focus:border-[#1B365D]"
                        style={{ fontSize: '16px' }}
                      >
                        {BLOOD_TYPES.map(bt => <option key={bt}>{bt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Allergies</label>
                      {ta('allergies', 2)}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Current medications summary</label>
                      {ta('current_meds_summary', 3)}
                    </div>
                  </div>
                </Section>

                <Section title="Primary Doctor">
                  <div className="flex flex-col gap-3 py-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Doctor name</label>
                      {inp('primary_doctor_name', { placeholder: 'Dr. Sarah Williams' })}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
                      {inp('primary_doctor_phone', { type: 'tel', placeholder: '(336) 555-0100' })}
                    </div>
                  </div>
                </Section>

                <Section title="Emergency Contact 1">
                  <div className="flex flex-col gap-3 py-3">
                    {[
                      ['ec1_name', 'Name', 'Jane Johnson'],
                      ['ec1_relationship', 'Relationship', 'Daughter'],
                      ['ec1_phone', 'Phone', '(336) 555-0200'],
                    ].map(([key, label, placeholder]) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                        {inp(key, { placeholder, type: key.includes('phone') ? 'tel' : 'text' })}
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Emergency Contact 2">
                  <div className="flex flex-col gap-3 py-3">
                    {[
                      ['ec2_name', 'Name', 'Robert Johnson'],
                      ['ec2_relationship', 'Relationship', 'Son'],
                      ['ec2_phone', 'Phone', '(336) 555-0300'],
                    ].map(([key, label, placeholder]) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                        {inp(key, { placeholder, type: key.includes('phone') ? 'tel' : 'text' })}
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Insurance">
                  <div className="flex flex-col gap-3 py-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Insurance company</label>
                      {inp('insurance_company', { placeholder: 'BlueCross BlueShield' })}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Policy number</label>
                      {inp('policy_number', { placeholder: 'XYZ123456789' })}
                    </div>
                  </div>
                </Section>

                <Section title="Special Instructions">
                  <div className="py-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Instructions for first responders
                    </label>
                    {ta('special_instructions', 4)}
                  </div>
                </Section>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full py-4 rounded-xl bg-red-600 text-white font-semibold text-lg disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Emergency Info'}
                </button>
              </>
            ) : (
              /* ── DISPLAY MODE ── */
              <>
                {!hasRecord ? (
                  <div className="text-center py-16 text-gray-400" style={{ fontSize: '16px' }}>
                    No emergency info saved yet. Tap Edit to add.
                  </div>
                ) : (
                  <>
                    <Section title="Personal Information">
                      <Field label="Full legal name" value={info.full_name} />
                      <Field label="Date of birth" value={info.date_of_birth} />
                      <Field label="Blood type" value={info.blood_type !== 'Unknown' ? info.blood_type : null} />
                      <Field label="Allergies" value={info.allergies} />
                      <Field label="Current medications" value={info.current_meds_summary} />
                    </Section>

                    <Section title="Primary Doctor">
                      <Field label="Name" value={info.primary_doctor_name} />
                      <Field label="Phone" value={info.primary_doctor_phone} />
                    </Section>

                    <Section title="Emergency Contact 1">
                      <Field label="Name" value={info.ec1_name} />
                      <Field label="Relationship" value={info.ec1_relationship} />
                      <Field label="Phone" value={info.ec1_phone} />
                    </Section>

                    <Section title="Emergency Contact 2">
                      <Field label="Name" value={info.ec2_name} />
                      <Field label="Relationship" value={info.ec2_relationship} />
                      <Field label="Phone" value={info.ec2_phone} />
                    </Section>

                    <Section title="Insurance">
                      <Field label="Company" value={info.insurance_company} />
                      <Field label="Policy number" value={info.policy_number} />
                    </Section>

                    {info.special_instructions && (
                      <Section title="Special Instructions for First Responders">
                        <Field label="" value={info.special_instructions} />
                      </Section>
                    )}

                    <p className="text-center text-xs text-gray-400 pb-4">
                      📸 Screenshot this page to have emergency info offline
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
