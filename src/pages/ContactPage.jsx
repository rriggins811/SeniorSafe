import { useNavigate } from 'react-router-dom'
import { MessageSquare, CalendarDays, HelpCircle, ArrowLeft } from 'lucide-react'

export default function ContactPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Header */}
      <div className="bg-[#1B365D] px-6 pt-12 pb-8">
        <div className="max-w-sm mx-auto">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-white/70 text-sm mb-4"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <h1 className="text-white text-2xl font-bold">Contact Ryan</h1>
          <p className="text-[#D4A843] text-sm mt-1">Licensed NC Realtor &amp; Senior Transition Advisor</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-8 max-w-sm mx-auto w-full flex flex-col gap-4">
        <p className="text-gray-600 text-base text-center">
          Have a question? Ryan is one tap away.
        </p>
        <div className="text-center text-[#1B365D] font-semibold text-lg">
          (336) 553-8933
        </div>

        {/* Button 1: Text Ryan */}
        <a
          href="sms:3365538933"
          className="w-full flex items-center gap-4 bg-[#1B365D] rounded-2xl px-6 py-5 shadow-sm active:opacity-90 no-underline"
        >
          <div className="bg-white/15 rounded-xl p-3">
            <MessageSquare size={28} color="#ffffff" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-white font-semibold text-lg">Text Ryan</span>
            <span className="text-white/70 text-sm">(336) 553-8933</span>
          </div>
        </a>

        {/* Button 2: Book a Free Call */}
        <a
          href="https://ryanriggins.com"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-4 bg-[#D4A843] rounded-2xl px-6 py-5 shadow-sm active:opacity-90 no-underline"
        >
          <div className="bg-white/20 rounded-xl p-3">
            <CalendarDays size={28} color="#1B365D" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[#1B365D] font-semibold text-lg">Book a Free Call</span>
            <span className="text-[#1B365D]/70 text-sm">Schedule time with Ryan</span>
          </div>
        </a>

        {/* Button 3: Quick Question */}
        <a
          href="sms:3365538933?body=Hi Ryan, I have a quick question about my transition: "
          className="w-full flex items-center gap-4 bg-white border-2 border-[#1B365D] rounded-2xl px-6 py-5 shadow-sm active:opacity-90 no-underline"
        >
          <div className="bg-[#F5F5F5] rounded-xl p-3">
            <HelpCircle size={28} color="#1B365D" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[#1B365D] font-semibold text-lg">Quick Question</span>
            <span className="text-gray-500 text-sm">Pre-filled message to Ryan</span>
          </div>
        </a>
      </div>

      <div className="pb-8 text-center">
        <p className="text-xs text-gray-400">Riggins Strategic Solutions</p>
      </div>
    </div>
  )
}
