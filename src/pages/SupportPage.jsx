import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronDown, ChevronUp, HelpCircle, Phone, Mail,
  Calendar, Globe, BookOpen, Settings, CreditCard, MessageCircle
} from 'lucide-react'
import { openExternalLink } from '../lib/platform'

const sections = [
  {
    title: 'Getting Started',
    icon: BookOpen,
    items: [
      {
        q: 'How do I create an account?',
        a: 'Tap "Get Started" on the welcome screen and fill in your name, email, and a secure password. You\'ll be guided through a short onboarding to personalize your experience. If you received an invite code from a family member, enter it during signup to join their family group automatically.'
      },
      {
        q: 'How do I invite family members?',
        a: 'Go to the Family Hub and tap "Invite Family." You\'ll see a unique 6-character family code you can share via text or email. Family members visit the signup page with your code (or enter it manually) to join your family group. You can invite as many family members as you\'d like.'
      },
      {
        q: 'What is the daily check-in?',
        a: 'The daily check-in is the "I\'m Okay Today" button on your dashboard. Tap it once each day to let your family know you\'re doing well. Premium subscribers get automatic SMS notifications sent to all family members. If you haven\'t checked in by your set time, family members will see a reminder on their dashboard.'
      },
      {
        q: 'How do I set up medication reminders?',
        a: 'Go to the Medications page and tap "Add Medication." Enter the medication name, dosage, frequency, and scheduled times. Toggle on "SMS Reminders" to receive text message reminders at each scheduled time. You\'ll need to enter the phone number where you\'d like to receive the reminders.'
      }
    ]
  },
  {
    title: 'Features',
    icon: Settings,
    items: [
      {
        q: 'What is the Document Vault?',
        a: 'The Document Vault is a secure place to store important documents like legal papers, medical records, financial documents, and personal files. Upload PDFs, photos, and images up to 10MB each. Documents are organized by category and protected with bank-level encryption. Admin users can toggle vault sharing to let family members view documents read-only.'
      },
      {
        q: 'How does the AI Assistant work?',
        a: 'The AI Assistant is your personal guide for navigating senior transitions. Ask questions about senior housing, caregiving, legal planning, medication management, or any family coordination topic. Premium subscribers get 20 messages per month. The assistant knows your family\'s specific situation and provides personalized guidance.'
      },
      {
        q: 'What is the Emergency Info Card?',
        a: 'The Emergency Info Card stores critical information first responders may need: blood type, allergies, current medications, doctors, emergency contacts, and insurance details. This information is available to all family members and can be shown to medical professionals in an emergency.'
      },
      {
        q: 'How do appointments work?',
        a: 'The Appointments page lets you track medical, dental, vision, therapy, and other appointments. Add the provider name, date, time, location, and notes. You can download any appointment as a calendar file (.ics) to add it to your phone\'s calendar. All family members can see upcoming appointments.'
      },
      {
        q: 'How does Family Hub messaging work?',
        a: 'The Family Hub is a shared space where all family members can post messages and photos. It\'s a simple way to keep everyone in the loop about your loved one\'s care. Messages are visible to all members of your family group. You can also share photos from visits or daily life.'
      },
      {
        q: 'What does the "I Need Help" button do?',
        a: 'The "I Need Help" button on the dashboard sends an urgent SMS alert to every family member who has a phone number on file. Use it when you need immediate assistance. A confirmation prompt prevents accidental alerts. This feature is available to Premium subscribers.'
      }
    ]
  },
  {
    title: 'Account & Billing',
    icon: CreditCard,
    items: [
      {
        q: 'What\'s included in the free plan?',
        a: 'The free plan includes daily check-ins (in-app only, no SMS), viewing family messages, and access to the Emergency Info Card. Features like the Document Vault, AI Assistant, Medications, Appointments, Family Photos, and SMS notifications require a Premium subscription.'
      },
      {
        q: 'How much does Premium cost?',
        a: 'SeniorSafe Premium is $14.99 per month. It includes all features: SMS check-in notifications, the "I Need Help" emergency alerts, Document Vault, AI Assistant (20 messages/month), Medication Tracking with SMS reminders, Appointments, Family Photos, and priority support.'
      },
      {
        q: 'How do I upgrade to Premium?',
        a: 'Go to your Profile page and tap "Manage Subscription" to upgrade. You can also tap the upgrade prompt that appears on any locked feature. Payment is processed securely through Stripe. You can cancel anytime from your Profile page.'
      },
      {
        q: 'How do I cancel my subscription?',
        a: 'Go to your Profile page, scroll to the Subscription section, and tap "Manage Subscription." You can cancel at any time and you\'ll retain Premium access until the end of your current billing period. No cancellation fees — you can resubscribe whenever you\'d like.'
      }
    ]
  },
  {
    title: 'Frequently Asked Questions',
    icon: MessageCircle,
    items: [
      {
        q: 'Is my data secure?',
        a: 'Yes. SeniorSafe uses Supabase with row-level security, meaning each family\'s data is completely isolated. Documents are stored in encrypted private storage with signed URLs that expire after one hour. We never share your data with third parties. All connections use HTTPS encryption.'
      },
      {
        q: 'Can multiple family members use the app?',
        a: 'Absolutely! One family admin creates the account and invites other members using a unique family code. All members can view check-ins, messages, medications, appointments, and emergency info. The admin manages the subscription and can toggle features like vault sharing.'
      },
      {
        q: 'What happens if I forget my password?',
        a: 'On the Sign In page, tap "Forgot password?" and enter your email address. You\'ll receive a password reset link via email. Follow the link to create a new password. If you don\'t see the email, check your spam folder or contact support.'
      },
      {
        q: 'Does the app work on iPhone and Android?',
        a: 'Yes! SeniorSafe is a web app that works on any device with a modern browser. You can install it as an app on your home screen for quick access — you\'ll be prompted to install when you first visit. It works on iPhones (Safari), Android phones (Chrome), tablets, and desktop computers.'
      },
      {
        q: 'Can I use the app for more than one senior?',
        a: 'Currently, each family group is centered around one senior. If you\'re helping multiple seniors (for example, both parents), you would create separate accounts for each. We\'re exploring multi-senior support for a future update.'
      },
      {
        q: 'Who built SeniorSafe?',
        a: 'SeniorSafe was built by Ryan Riggins of Riggins Strategic Solutions. Ryan is a licensed NC Realtor who switched from real estate investing to helping families navigate senior transitions. The app is a companion to the Senior Transition Blueprint, a comprehensive guide covering all aspects of senior housing decisions.'
      }
    ]
  }
]

function AccordionItem({ question, answer }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 px-1 text-left gap-3"
      >
        <span className="text-sm font-medium text-[#1B365D] flex-1">{question}</span>
        {open
          ? <ChevronUp size={16} className="text-[#D4A843] shrink-0" />
          : <ChevronDown size={16} className="text-gray-400 shrink-0" />
        }
      </button>
      {open && (
        <div className="px-1 pb-3">
          <p className="text-sm text-gray-600 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  )
}

// eslint-disable-next-line no-unused-vars
function AccordionSection({ title, icon: Icon, items }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1B365D]/10 flex items-center justify-center">
            <Icon size={16} className="text-[#1B365D]" />
          </div>
          <span className="font-semibold text-[#1B365D]">{title}</span>
        </div>
        {expanded
          ? <ChevronUp size={18} className="text-[#D4A843]" />
          : <ChevronDown size={18} className="text-gray-400" />
        }
      </button>
      {expanded && (
        <div className="px-4 pb-2">
          {items.map((item, i) => (
            <AccordionItem key={i} question={item.q} answer={item.a} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SupportPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-10">
      {/* Header */}
      <div className="bg-[#1B365D] text-white px-4 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-xl font-bold">Help & Support</h1>
        </div>
        <p className="text-white/70 text-sm ml-8">
          Find answers, learn about features, or get in touch.
        </p>
      </div>

      <div className="px-4 mt-4 space-y-3">
        {/* Accordion sections */}
        {sections.map((section, i) => (
          <AccordionSection
            key={i}
            title={section.title}
            icon={section.icon}
            items={section.items}
          />
        ))}

        {/* Contact Us — always visible */}
        <div className="bg-white rounded-2xl shadow-sm px-4 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-[#D4A843]/20 flex items-center justify-center">
              <HelpCircle size={16} className="text-[#D4A843]" />
            </div>
            <span className="font-semibold text-[#1B365D]">Contact Us</span>
          </div>

          <div className="space-y-2">
            {/* Phone */}
            <a
              href="sms:+13365538933?body=Hi%20Ryan%2C%20I%20need%20help%20with%20SeniorSafe."
              className="flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <Phone size={18} className="text-[#1B365D] shrink-0" />
              <div>
                <p className="text-[#1B365D] font-semibold text-sm">Text Ryan</p>
                <p className="text-gray-400 text-xs">(336) 553-8933</p>
              </div>
            </a>

            {/* Email */}
            <a
              href="mailto:support@seniorsafeapp.com?subject=SeniorSafe%20Support%20Request"
              className="flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <Mail size={18} className="text-[#1B365D] shrink-0" />
              <div>
                <p className="text-[#1B365D] font-semibold text-sm">Email Support</p>
                <p className="text-gray-400 text-xs">support@seniorsafeapp.com</p>
              </div>
            </a>

            {/* Booking */}
            <button
              onClick={() => openExternalLink('https://api.leadconnectorhq.com/widget/booking/PEGCu2kXYDZgAPPzXGv5')}
              className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <Calendar size={18} className="text-[#1B365D] shrink-0" />
              <div>
                <p className="text-[#1B365D] font-semibold text-sm">Book a Call</p>
                <p className="text-gray-400 text-xs">Schedule a free consultation</p>
              </div>
            </button>

            {/* Website */}
            <button
              onClick={() => openExternalLink('https://rigginsstrategicsolutions.com')}
              className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <Globe size={18} className="text-[#1B365D] shrink-0" />
              <div>
                <p className="text-[#1B365D] font-semibold text-sm">Visit Our Website</p>
                <p className="text-gray-400 text-xs">rigginsstrategicsolutions.com</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
