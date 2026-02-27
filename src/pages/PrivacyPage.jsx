import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield } from 'lucide-react'

const SECTIONS = [
  {
    title: 'What We Collect',
    body: 'Account information (name, email, phone), family member names and phones, medication information you enter, documents you upload, appointment information, emergency information, daily check-in activity, and AI chat conversations.',
  },
  {
    title: 'How We Use Your Data',
    body: 'To provide SeniorSafe to you and your family, to send SMS notifications you requested, to personalize the AI assistant, and to improve the service.',
  },
  {
    title: "What We Don't Do",
    body: 'We do not sell your personal information. We do not share your data with advertisers. We do not share health or family information with third parties except our technology providers Supabase and Anthropic.',
  },
  {
    title: 'SMS Notifications',
    body: 'If you provide a phone number and enable notifications, we will send SMS messages. Message and data rates may apply. You can opt out at any time in Profile & Settings.',
  },
  {
    title: 'Data Storage',
    body: 'Your data is stored securely using Supabase, a SOC 2 compliant database provider.',
  },
  {
    title: 'Your Rights',
    body: 'You can request deletion of your account and all data at any time by contacting Ryan Riggins at (336) 553-8933 or ryan@rigginsstrategicsolutions.com. We will process deletion requests within 30 days.',
  },
  {
    title: "Children's Privacy",
    body: 'SeniorSafe is not intended for users under 18.',
  },
  {
    title: 'Contact',
    body: 'Riggins Strategic Solutions LLC · Ryan Riggins · (336) 553-8933 · ryan@rigginsstrategicsolutions.com · rigginsstrategicsolutions.com',
  },
]

export default function PrivacyPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Header */}
      <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white/70 text-sm mb-4"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2">
              <Shield size={20} color="#D4A843" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Privacy Policy</h1>
              <p className="text-white/60 text-sm">Last updated: February 27, 2026</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-lg mx-auto flex flex-col gap-4">

          <div className="bg-white rounded-2xl px-5 py-4 shadow-sm">
            <p className="text-gray-600 text-sm leading-relaxed">
              <span className="font-semibold text-[#1B365D]">Riggins Strategic Solutions, LLC</span> operates SeniorSafe. This policy explains what data we collect, how we use it, and your rights.
            </p>
          </div>

          {SECTIONS.map(s => (
            <div key={s.title} className="bg-white rounded-2xl px-5 py-4 shadow-sm">
              <p className="text-[#1B365D] font-semibold text-sm mb-2">{s.title}</p>
              <p className="text-gray-600 text-sm leading-relaxed">{s.body}</p>
            </div>
          ))}

          <p className="text-center text-xs text-gray-400 pb-4">
            Riggins Strategic Solutions, LLC · rigginsstrategicsolutions.com
          </p>
        </div>
      </div>
    </div>
  )
}
