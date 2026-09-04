import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Eye, EyeOff } from 'lucide-react'

// Shared pieces for the signup and onboarding screens. Kept deliberately
// plain: big targets, one idea per screen, nothing that punishes a mis-tap.

export function Shell({ step, total, onBack, children, wide }) {
  const pct = step && total ? (step / total) * 100 : 0
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="bg-[#1B365D] flex-shrink-0">
        <div className="px-6 pt-12 pb-4 max-w-md mx-auto w-full flex items-center justify-between">
          {onBack ? (
            <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-lg text-white/70 active:text-white min-w-[44px] min-h-[44px] flex items-center justify-center">
              <ChevronLeft size={26} />
            </button>
          ) : <div className="w-11" />}
          <span className="text-[#D4A843] text-sm font-semibold">
            {step && total ? `Step ${step} of ${total}` : 'SeniorSafe'}
          </span>
          <div className="w-11" />
        </div>
        {step && total ? (
          <div className="w-full h-1 bg-white/20">
            <div className="h-full bg-[#D4A843] transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>
      <div className={`flex-1 px-6 pt-8 pb-10 ${wide ? 'max-w-lg' : 'max-w-md'} mx-auto w-full flex flex-col gap-6 overflow-y-auto keyboard-safe-bottom`}>
        {children}
      </div>
    </div>
  )
}

export function Heading({ title, sub, large }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-[#1B365D] font-bold" style={{ fontSize: large ? '32px' : '26px', lineHeight: 1.15 }}>{title}</h1>
      {sub && <p className="text-[#6B645A]" style={{ fontSize: large ? '20px' : '17px', lineHeight: 1.45 }}>{sub}</p>}
    </div>
  )
}

export function Field({ label, hint, value, onChange, type = 'text', large, autoFocus, ...props }) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  const inputType = isPassword && show ? 'text' : type
  return (
    <div>
      <label className="block text-gray-700 font-medium mb-2" style={{ fontSize: large ? '18px' : '16px' }}>{label}</label>
      <div className="relative">
        <input
          {...props}
          type={inputType}
          value={value}
          autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)}
          className="w-full px-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] text-[#2D2A24]"
          style={{ fontSize: large ? '20px' : '18px', paddingTop: large ? '18px' : '14px', paddingBottom: large ? '18px' : '14px', paddingRight: isPassword ? '64px' : undefined }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-2 text-[#6B645A] flex items-center gap-1 text-sm"
          >
            {show ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        )}
      </div>
      {hint && <p className="text-[#6B645A] mt-1.5" style={{ fontSize: '14px' }}>{hint}</p>}
    </div>
  )
}

export function BigButton({ onClick, disabled, children, secondary, large, type = 'button', href }) {
  const cls = secondary
    ? 'w-full rounded-2xl border-2 border-[#1B365D] text-[#1B365D] font-bold bg-white disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2'
    : 'w-full rounded-2xl bg-[#1B365D] text-[#D4A843] font-bold disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2'
  const style = { fontSize: large ? '22px' : '19px', paddingTop: large ? '22px' : '18px', paddingBottom: large ? '22px' : '18px' }
  if (href) {
    return <a href={href} onClick={onClick} className={cls} style={style}>{children}</a>
  }
  return <button type={type} onClick={onClick} disabled={disabled} className={cls} style={style}>{children}</button>
}

export function TextLink({ onClick, children, to }) {
  const cls = 'text-[#1B365D] font-semibold underline underline-offset-2 text-base'
  if (to) return <Link to={to} className={cls}>{children}</Link>
  return <button type="button" onClick={onClick} className={cls}>{children}</button>
}

export function ErrorText({ children }) {
  if (!children) return null
  return <p className="text-[#B5483F] text-base text-center" role="alert">{children}</p>
}

// The one line of disclosure that replaces the two full-screen interstitials.
// The full text still lives in Terms and in Settings.
export function Disclosure() {
  return (
    <p className="text-[#6B645A] text-center leading-relaxed" style={{ fontSize: '13px' }}>
      SeniorSafe helps families stay in touch. It is not a medical device or an emergency service; if someone is in danger, call 911.
      By continuing you agree to the{' '}
      <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy Policy</Link>.
    </p>
  )
}

export function OAuthButtons({ onGoogle, onApple, googleLoading, appleLoading, label = 'Continue' }) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onGoogle}
        disabled={googleLoading}
        className="w-full py-4 rounded-xl border-2 border-gray-200 bg-white text-gray-700 font-semibold text-base flex items-center justify-center gap-3 disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
        </svg>
        {googleLoading ? 'Opening Google...' : `${label} with Google`}
      </button>
      <button
        type="button"
        onClick={onApple}
        disabled={appleLoading}
        className="w-full py-4 rounded-xl bg-black text-white font-semibold text-base flex items-center justify-center gap-3 disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M13.71 9.54c-.02-2.17 1.77-3.22 1.85-3.27-1.01-1.48-2.58-1.68-3.13-1.7-1.33-.14-2.6.79-3.28.79-.68 0-1.72-.77-2.83-.75-1.46.02-2.8.85-3.55 2.15-1.52 2.63-.39 6.52 1.09 8.65.72 1.04 1.58 2.22 2.71 2.17 1.09-.04 1.5-.7 2.81-.7 1.31 0 1.68.7 2.82.68 1.17-.02 1.91-1.06 2.63-2.11.83-1.21 1.17-2.38 1.19-2.44-.03-.01-2.28-.88-2.31-3.47zM11.56 3.28c.6-.73 1.01-1.73.9-2.74-.87.04-1.92.58-2.54 1.3-.56.64-1.05 1.67-.92 2.66.97.07 1.96-.49 2.56-1.22z"/>
        </svg>
        {appleLoading ? 'Opening Apple...' : `${label} with Apple`}
      </button>
    </div>
  )
}

export function Divider({ children = 'or' }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-sm text-gray-400">{children}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  )
}

export function Select({ label, value, onChange, options, hint, large }) {
  return (
    <div>
      <label className="block text-gray-700 font-medium mb-2" style={{ fontSize: large ? '18px' : '16px' }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#1B365D] bg-white text-[#2D2A24] font-semibold"
        style={{ fontSize: large ? '20px' : '18px', paddingTop: '14px', paddingBottom: '14px' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-[#6B645A] mt-1.5" style={{ fontSize: '14px' }}>{hint}</p>}
    </div>
  )
}
