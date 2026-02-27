import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield } from 'lucide-react'

const SECTIONS = [
  {
    title: '1. What SeniorSafe Is',
    body: 'SeniorSafe is a family coordination tool designed to help families navigate senior housing transitions. It is not a medical provider, legal advisor, financial advisor, or emergency response service.',
  },
  {
    title: '2. Not Medical or Legal Advice',
    body: 'Nothing in SeniorSafe — including the AI assistant, medication tracker, or any content — constitutes medical advice, legal advice, or financial advice. Always consult qualified professionals for medical, legal, and financial decisions.',
  },
  {
    title: '3. Not an Emergency Service',
    body: 'SeniorSafe is not a substitute for emergency services. If you or someone you know is in danger, call 911 immediately. The "I\'m Okay" check-in feature is a convenience tool only and should not be relied upon as a safety monitoring system.',
  },
  {
    title: '4. Your Account',
    body: 'You are responsible for maintaining the confidentiality of your account credentials. You agree to provide accurate information when creating your account. You must be 18 or older to create an account.',
  },
  {
    title: '5. Family Members',
    body: 'When you invite family members to your account, you represent that you have their consent to share family coordination information within the app.',
  },
  {
    title: '6. Your Data',
    body: 'You own your data. We do not sell your personal information to third parties. We use your data only to provide and improve SeniorSafe services.',
  },
  {
    title: '7. Beta Service',
    body: 'SeniorSafe is currently in beta. Features may change, be added, or be removed. We make no guarantees of uptime or data preservation during the beta period.',
  },
  {
    title: '8. Limitation of Liability',
    body: 'Riggins Strategic Solutions shall not be liable for any indirect, incidental, or consequential damages arising from your use of SeniorSafe.',
  },
  {
    title: '9. Changes to Terms',
    body: 'We may update these terms at any time. Continued use of SeniorSafe after changes constitutes acceptance of the new terms.',
  },
  {
    title: '10. Contact',
    body: 'Questions? Text or call Ryan Riggins at (336) 553-8933 or email ryan@rigginsstrategicsolutions.com.',
  },
]

export default function TermsPage() {
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
              <h1 className="text-white font-bold" style={{ fontSize: '20px' }}>Terms of Service</h1>
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
              SeniorSafe is operated by <span className="font-semibold text-[#1B365D]">Riggins Strategic Solutions, LLC</span>. By creating an account and using SeniorSafe, you agree to these terms.
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
