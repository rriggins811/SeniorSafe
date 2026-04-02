import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield } from 'lucide-react'

const SECTIONS = [
  {
    title: '1. Information We Collect',
    body: `When you create a SeniorSafe account, we collect:

• Account information: name, email address, phone number, and password
• Family information: family member names, phone numbers, and relationships
• Health-related information you voluntarily enter: medication names, dosages, schedules, and appointment details
• Documents you upload to the secure vault (legal, medical, financial, personal)
• Emergency contact information and medical details (blood type, allergies, doctors)
• Daily check-in activity and timestamps
• AI assistant chat conversations
• Device information and usage data for app functionality`,
  },
  {
    title: '2. How We Use Your Information',
    body: `We use your information to:

• Provide SeniorSafe services to you and your family members
• Send SMS notifications you have enabled (check-in alerts, medication reminders, family messages)
• Power the AI assistant with context about your family's needs
• Process subscription payments
• Improve app performance and fix bugs
• Comply with legal obligations

We do NOT use your information for advertising, marketing to third parties, or profiling.`,
  },
  {
    title: '3. AI Assistant & Third-Party Services',
    body: `SeniorSafe uses Anthropic's Claude AI to power the in-app AI assistant.

What is sent to Anthropic: Your text messages to the AI assistant are sent to Anthropic's servers to generate responses. Your first name and general family context (e.g., "helping Mom with a senior transition") are included to personalize responses.

What is NOT sent to Anthropic: Your medication data, document vault contents, check-in history, family messages, emergency information, and financial details are NOT shared with Anthropic unless you specifically type this information into your AI chat messages.

Data retention by Anthropic: Anthropic processes your messages to generate responses and does not retain your conversations for training purposes under our API agreement.

Your control: You can choose not to use the AI assistant. All other SeniorSafe features work without it. You are shown a disclosure and must consent before first use of the AI assistant.`,
  },
  {
    title: '4. Third-Party Service Providers',
    body: `We use the following service providers to operate SeniorSafe:

• Supabase — Database hosting and user authentication. Your data is stored on Supabase's SOC 2 Type II compliant infrastructure with encryption at rest and in transit.
• Anthropic — AI assistant (Claude). See Section 3 for details.
• Twilio — SMS notifications. Phone numbers and message content are transmitted to Twilio for delivery.
• Stripe — Payment processing for web subscriptions. Stripe handles all payment card data; we never store card numbers.
• Apple — In-App Purchase processing for iOS subscriptions. Apple handles payment through your Apple ID.
• Vercel — Web application hosting.

We do not sell your personal information to any third party.`,
  },
  {
    title: '5. Data Storage & Security',
    body: `Your data is stored securely using Supabase, hosted on Amazon Web Services (AWS) infrastructure.

Security measures include:
• Encryption at rest and in transit (TLS 1.2+)
• Row Level Security (RLS) ensuring users can only access their own family's data
• Secure authentication with email/password and OAuth providers
• Private document storage with signed, time-limited access URLs
• No API keys or credentials stored in client-side code`,
  },
  {
    title: '6. Family Data Sharing',
    body: `When you invite family members to your SeniorSafe account, the following data is shared within your family group:

• Check-in status and history
• Family messages and photos
• Medication schedules and dose tracking (viewable, not editable by other members)
• Appointment information
• Emergency information card

Only users you explicitly invite with your family code can see this data. You can remove family members at any time.`,
  },
  {
    title: '7. SMS Notifications',
    body: `If you provide a phone number and enable notifications, we send SMS messages through Twilio for check-in alerts, medication reminders, and family messages. Message and data rates may apply. Message frequency varies based on your settings. You can opt out at any time in your Profile settings or by replying STOP to any message.`,
  },
  {
    title: '8. Your Rights',
    body: `You have the right to:

• Access your personal data through the app at any time
• Correct inaccurate information in your profile
• Delete your account and all associated data
• Export your data upon request
• Opt out of SMS notifications
• Withdraw AI assistant consent

To request account deletion or data export, contact us at ryan@rigginsstrategicsolutions.com or (336) 553-8933. Deletion requests are processed within 30 days.`,
  },
  {
    title: '9. Children\'s Privacy',
    body: `SeniorSafe is designed for adults coordinating senior care. We do not knowingly collect information from anyone under 13 years of age. Users must be at least 13 to create an account. If we learn we have collected data from a child under 13, we will delete it promptly.`,
  },
  {
    title: '10. Data Retention',
    body: `We retain your data for as long as your account is active. AI conversation history is automatically deleted after 90 days. If you delete your account, all personal data is removed within 30 days, except where retention is required by law.`,
  },
  {
    title: '11. Changes to This Policy',
    body: `We may update this privacy policy from time to time. We will notify you of material changes through the app or via email. Continued use of SeniorSafe after changes constitutes acceptance of the updated policy.`,
  },
  {
    title: '12. Contact Us',
    body: `Riggins Strategic Solutions, LLC
Ryan Riggins
Email: ryan@rigginsstrategicsolutions.com
Phone: (336) 553-8933
Website: rigginsstrategicsolutions.com`,
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
              <span className="font-semibold text-[#1B365D]">Riggins Strategic Solutions, LLC</span> ("we", "us", "our") operates SeniorSafe. This Privacy Policy explains what information we collect, how we use it, who we share it with, and your rights regarding your data. SeniorSafe is a family coordination tool — not a medical device, emergency service, or healthcare provider.
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
