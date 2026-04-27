import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield } from 'lucide-react'

const SECTIONS = [
  {
    title: '1. About SeniorSafe',
    body: `SeniorSafe is a family coordination tool designed to help families navigate senior transitions. It provides daily check-ins, medication tracking, document storage, family messaging, appointment management, and an AI assistant.

SeniorSafe is NOT a medical device, does not provide medical advice, and is not intended to diagnose, treat, cure, or prevent any medical condition. It is NOT an emergency monitoring service or a substitute for professional medical care, in-person supervision, or emergency services.`,
  },
  {
    title: '2. Emergency Services Disclaimer',
    body: `SeniorSafe is NOT an emergency monitoring service. If you or a loved one are experiencing a medical emergency, call 911 immediately.

Do not rely solely on automated check-ins for the safety of any individual. SeniorSafe is a coordination tool, not a substitute for in-person care or professional medical monitoring.

SeniorSafe is not responsible for notification delivery failures including but not limited to SMS delivery issues, push notification failures, or internet connectivity problems.`,
  },
  {
    title: '3. Not Medical or Legal Advice',
    body: `Nothing in SeniorSafe — including the AI assistant, medication tracker, or any content — constitutes medical advice, legal advice, or financial advice. The AI assistant is powered by Anthropic's Claude and may produce inaccurate information. Always consult qualified professionals for medical, legal, and financial decisions.

The medication tracking feature is a personal reminder tool only. It does not replace professional pharmaceutical guidance. Always follow your healthcare provider's instructions regarding medications.`,
  },
  {
    title: '4. Eligibility',
    body: `You must be at least 13 years of age to create a SeniorSafe account. By creating an account, you represent that you are at least 13 years old. Users under 18 should have parental consent before using SeniorSafe.`,
  },
  {
    title: '5. Your Account',
    body: `You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You agree to provide accurate, current information when creating your account and to update it as needed. You must notify us immediately of any unauthorized access to your account.`,
  },
  {
    title: '6. Family Members & Consent',
    body: `When you invite family members to your SeniorSafe account, you represent that you have their consent to share family coordination information within the app. You are responsible for ensuring all invited family members are aware of and agree to these Terms of Service and our Privacy Policy.`,
  },
  {
    title: '7. AI Assistant',
    body: `The AI assistant is powered by Anthropic's Claude. When you use the AI assistant, your messages are sent to Anthropic to generate responses. By using the AI assistant, you acknowledge:

• AI responses may be inaccurate, incomplete, or inappropriate
• The AI does not provide medical, legal, or financial advice
• You should not rely on AI responses for health or safety decisions
• Your chat messages are processed by Anthropic (see our Privacy Policy for details)
• You must consent to AI data sharing before first use`,
  },
  {
    title: '8. Your Data',
    body: `You own your data. We do not sell your personal information to third parties. We use your data only to provide and improve SeniorSafe services. See our Privacy Policy for complete details on data collection, use, storage, and your rights.`,
  },
  {
    title: '9. Subscriptions & Billing',
    body: `SeniorSafe offers free and premium subscription tiers.

For iOS app subscribers: Payment is charged to your Apple ID account. Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period. You can manage and cancel subscriptions in your device Settings > Apple ID > Subscriptions.

For web subscribers: Payment is processed through Stripe. Subscriptions renew automatically. You can cancel at any time through your account settings.

No refunds are provided for partial billing periods. Prices may change with notice.`,
  },
  {
    title: '10. Acceptable Use',
    body: `You agree not to:

• Use SeniorSafe for any unlawful purpose
• Upload malicious files or content
• Attempt to access other users' data
• Interfere with the app's functionality
• Use the AI assistant to generate harmful, abusive, or illegal content
• Misrepresent SeniorSafe as a medical or emergency service`,
  },
  {
    title: '11. Limitation of Liability',
    body: `TO THE MAXIMUM EXTENT PERMITTED BY LAW, RIGGINS STRATEGIC SOLUTIONS, LLC SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF SENIORSAFE.

This includes but is not limited to: missed check-in notifications, failed SMS delivery, AI assistant errors, data loss, medication reminder failures, or any reliance on information provided through the app. SeniorSafe is provided "as is" without warranties of any kind.`,
  },
  {
    title: '12. Indemnification',
    body: `You agree to indemnify and hold harmless Riggins Strategic Solutions, LLC from any claims, damages, or expenses arising from your use of SeniorSafe or your violation of these Terms.`,
  },
  {
    title: '13. Changes to Terms',
    body: `We may update these terms at any time. We will notify you of material changes through the app or via email. Continued use of SeniorSafe after changes constitutes acceptance of the new terms. If you disagree with updated terms, you should stop using SeniorSafe and delete your account.`,
  },
  {
    title: '14. Governing Law',
    body: `These Terms are governed by the laws of the State of North Carolina, United States, without regard to conflict of law principles.`,
  },
  {
    title: '15. Contact',
    body: `Questions about these Terms? Contact us:

Riggins Strategic Solutions, LLC
Ryan Riggins
Email: ryan@rigginsstrategicsolutions.com
Phone: (336) 553-8933
Website: rigginsstrategicsolutions.com`,
  },
]

export default function TermsPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col">
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
              <p className="text-white/60 text-sm">Last updated: April 2, 2026</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-lg mx-auto flex flex-col gap-4">

          <div className="bg-white rounded-2xl px-5 py-4 shadow-sm">
            <p className="text-gray-600 text-sm leading-relaxed">
              SeniorSafe is operated by <span className="font-semibold text-[#1B365D]">Riggins Strategic Solutions, LLC</span> ("we", "us", "our"). By creating an account and using SeniorSafe, you agree to these Terms of Service and our Privacy Policy.
            </p>
          </div>

          {SECTIONS.map(s => (
            <div key={s.title} className="bg-white rounded-2xl px-5 py-4 shadow-sm">
              <p className="text-[#1B365D] font-semibold text-sm mb-2">{s.title}</p>
              <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{s.body}</p>
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
