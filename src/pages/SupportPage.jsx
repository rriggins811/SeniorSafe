import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronDown, ChevronUp, HelpCircle, Phone, Mail,
  Calendar, Globe, BookOpen, Settings, CreditCard, MessageCircle
} from 'lucide-react'
import { openExternalLink } from '../lib/platform'
import { SETUP_FAQ } from '../content/setupFaq'

const sections = [
  ...SETUP_FAQ.map(sec => ({ ...sec, icon: sec.audience === 'senior' ? HelpCircle : BookOpen })),
  {
    title: 'Getting Started',
    icon: BookOpen,
    items: [
      {
        q: 'What is the daily check-in?',
        a: 'The daily check-in is the "I\'m Okay Today" button on the senior\'s screen. Tap it once each day. The family sees it in the app right away. If it has not been tapped by the family\'s chosen time, one family contact gets a text on the free plan, and everyone in the family on the paid plan.'
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
        q: 'Who is Maggie?',
        a: 'Her name is Maggie, and everyone in the family gets the same one. For the person who checks in, she is an everyday helper: a recipe, a birthday card, how to do something on the phone. For the family, she knows Ryan\'s Senior Transition Blueprint and gives real answers about senior living, selling the house, Medicaid, siblings, and caregiver burnout, then tells you which professional should look at the specifics. She is not a doctor, lawyer, or financial advisor. Chats are private to the person typing. The free plan includes 10 messages, total; the paid plan includes her every day.'
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
        a: 'The "I Need Help" button on the senior\'s screen sends an urgent text asking someone to check on them: to one family contact on the free plan, to everyone in the family on the paid plan. A confirmation prompt prevents accidental alerts. It is not 911.'
      }
    ]
  },
  {
    title: 'Account & Billing',
    icon: CreditCard,
    items: [
      {
        q: 'What\'s included in the free plan?',
        a: 'Free forever: the daily "I\'m Okay" check-in with a push nudge, a text to one family contact when a check-in is missed or I Need Help is pressed, check-in history, the emergency card, medication reminders on the senior\'s screen, the senior\'s invite, siblings and caregivers joining by code to see the same board, and 10 messages with Maggie, total. Nothing to enter, no card, no clock.'
      },
      {
        q: 'How much does the paid plan cost?',
        a: 'One paid plan: $14.99 a month, or $140 a year. It turns on texts to everyone in the family, missed-dose alerts to the family, the document vault, family messages and photos, appointments, and Maggie every day. Paid features show a lock in the free app; tap one to see the price.'
      },
      {
        q: 'How do I start the paid plan?',
        a: 'Tap any locked feature, or go to your Profile page and tap "See the paid plan". A family that has never subscribed gets seven free days first: you add a card, and if you cancel before the seven days end you are not charged. Payment is processed securely through Stripe on the web, or through the App Store or Google Play in the apps. Cancel anytime from your Profile page.'
      },
      {
        q: 'How do I cancel my subscription?',
        a: 'Go to your Profile page, scroll to the Subscription section, and tap "Manage Subscription." You can cancel at any time and you\'ll retain Premium access until the end of your current billing period. No cancellation fees, you can resubscribe whenever you\'d like.'
      }
    ]
  },
  {
    title: 'Frequently Asked Questions',
    icon: MessageCircle,
    items: [
      {
        q: 'Is my data secure?',
        a: 'Yes, and here is what that means in plain words. Each family\'s records are walled off from every other family at the database level (row-level security), so nobody outside your family can read your check-ins, medications, emergency card or messages. Vault documents live in private storage; only your family can open them, and each link expires after an hour. Card numbers never touch our servers (Stripe, Apple and Google handle payment). Everything travels encrypted (HTTPS). We do not sell your information, and the only companies that touch it are the ones that run the app, listed in the Privacy Policy. Maggie\'s conversations are private to you and clear after 90 days. You can delete your account and everything in it from Settings at any time. We re-checked all of this on September 11, 2026.'
      },
      {
        q: 'Can multiple family members use the app?',
        a: 'Yes. One person sets up the family and manages the subscription, one person is the one who checks in each day, and everyone else joins with the link or family code. All members see check-ins, messages, medications, appointments, and emergency info.'
      },
      {
        q: 'What happens if I forget my password?',
        a: 'On the Sign In page, tap "Forgot password?" and enter your email address. You\'ll receive a password reset link via email. Follow the link to create a new password. If you don\'t see the email, check your spam folder or contact support.'
      },
      {
        q: 'Does the app work on iPhone and Android?',
        a: 'Yes! Hammock365 is a web app that works on any device with a modern browser. You can install it as an app on your home screen for quick access, you\'ll be prompted to install when you first visit. It works on iPhones (Safari), Android phones (Chrome), tablets, and desktop computers.'
      },
      {
        q: 'Can I use the app for more than one senior?',
        a: 'Currently, each family group is centered around one senior. If you\'re helping multiple seniors (for example, both parents), you would create separate accounts for each. We\'re exploring multi-senior support for a future update.'
      },
      {
        q: 'Who built Hammock365?',
        a: 'Hammock365 was built by Ryan Riggins of Riggins Strategic Solutions. Ryan is a licensed NC Realtor who switched from real estate investing to helping families navigate senior transitions. The app is a companion to the Senior Transition Blueprint, a comprehensive guide covering all aspects of senior housing decisions.'
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
        <span className="text-sm font-medium text-[#1F5A4B] flex-1">{question}</span>
        {open
          ? <ChevronUp size={16} className="text-[#F2B544] shrink-0" />
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

function AccordionSection({ title, icon: Icon, items }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1F5A4B]/10 flex items-center justify-center">
            <Icon size={16} className="text-[#1F5A4B]" />
          </div>
          <span className="font-semibold text-[#1F5A4B]">{title}</span>
        </div>
        {expanded
          ? <ChevronUp size={18} className="text-[#F2B544]" />
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
    <div className="min-h-screen bg-[#FAF8F4] pb-10">
      {/* Header */}
      <div className="bg-[#1F5A4B] text-white px-4 pt-12 pb-6">
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
        {/* How-to videos */}
        <button
          type="button"
          onClick={() => navigate('/how-to')}
          className="w-full text-left bg-white rounded-2xl border border-[#1F5A4B]/15 p-4 mb-4 shadow-sm active:scale-[0.99]"
        >
          <div className="flex items-start gap-3">
            <div className="bg-[#1F5A4B] rounded-xl p-2 flex-shrink-0">
              <BookOpen size={20} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-[#1F5A4B]">Watch the how-to videos</p>
              <p className="text-sm text-gray-600 mt-1">
                Five videos under thirty seconds: the invite link, medications, appointments, the emergency card, and the family page.
              </p>
            </div>
          </div>
        </button>

        {/* Accordion sections */}
        {sections.map((section, i) => (
          <AccordionSection
            key={i}
            title={section.title}
            icon={section.icon}
            items={section.items}
          />
        ))}

        {/* Contact Us, always visible */}
        <div className="bg-white rounded-2xl shadow-sm px-4 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-[#F2B544]/20 flex items-center justify-center">
              <HelpCircle size={16} className="text-[#F2B544]" />
            </div>
            <span className="font-semibold text-[#1F5A4B]">Contact Us</span>
          </div>

          <div className="space-y-2">
            {/* Phone */}
            <a
              href="sms:+13365538933?body=Hi%20Ryan%2C%20I%20need%20help%20with%20Hammock365."
              className="flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <Phone size={18} className="text-[#1F5A4B] shrink-0" />
              <div>
                <p className="text-[#1F5A4B] font-semibold text-sm">Text Ryan</p>
                <p className="text-gray-400 text-xs">(336) 553-8933</p>
              </div>
            </a>

            {/* Email */}
            <a
              href="mailto:support@hammock365.com?subject=Hammock365%20Support%20Request"
              className="flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <Mail size={18} className="text-[#1F5A4B] shrink-0" />
              <div>
                <p className="text-[#1F5A4B] font-semibold text-sm">Email Support</p>
                <p className="text-gray-400 text-xs">support@hammock365.com</p>
              </div>
            </a>

            {/* Booking */}
            <button
              onClick={() => openExternalLink('https://calendar.google.com/calendar/appointments/schedules/AcZssZ0y_kQQfkvnf6jQEBvA5X2Onolndq6VleuID3n9hDujDd4CjpOsaJzKqs_eXujvfVVayudxp2h5')}
              className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <Calendar size={18} className="text-[#1F5A4B] shrink-0" />
              <div>
                <p className="text-[#1F5A4B] font-semibold text-sm">Book a Call</p>
                <p className="text-gray-400 text-xs">Schedule a free consultation</p>
              </div>
            </button>

            {/* Website */}
            <button
              onClick={() => openExternalLink('https://rigginsstrategicsolutions.com')}
              className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <Globe size={18} className="text-[#1F5A4B] shrink-0" />
              <div>
                <p className="text-[#1F5A4B] font-semibold text-sm">Visit Our Website</p>
                <p className="text-gray-400 text-xs">rigginsstrategicsolutions.com</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
