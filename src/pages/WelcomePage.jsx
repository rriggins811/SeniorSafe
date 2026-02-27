import { useNavigate, Link } from 'react-router-dom'
import { Shield } from 'lucide-react'

export default function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="bg-[#1B365D] rounded-2xl p-4">
            <Shield size={48} color="#D4A843" strokeWidth={1.5} />
          </div>
          <h1 className="text-4xl font-bold text-[#1B365D] tracking-tight">
            SeniorSafe
          </h1>
        </div>

        {/* Tagline + Description */}
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-xl font-semibold text-[#1B365D]">
            Your family. One place. One plan.
          </p>
          <p className="text-base text-gray-500 leading-relaxed">
            The app built for families navigating senior transitions.
          </p>
        </div>

        {/* Buttons */}
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={() => navigate('/signup')}
            className="w-full py-4 rounded-xl bg-[#1B365D] text-[#D4A843] font-semibold text-lg"
          >
            Get Started
          </button>
          <button
            onClick={() => navigate('/signin')}
            className="w-full py-4 rounded-xl border-2 border-[#1B365D] text-[#1B365D] font-semibold text-lg bg-white"
          >
            Sign In
          </button>
        </div>

        {/* Footer note */}
        <p className="text-xs text-gray-400 text-center">
          Powered by Riggins Strategic Solutions
        </p>
        <p className="text-xs text-gray-400 text-center">
          <Link to="/terms" className="underline hover:text-gray-600">Terms of Service</Link>
          {' | '}
          <Link to="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
