import { AlertTriangle, CheckCircle } from 'lucide-react'

export default function HelpModal({
  open,
  helpFailed,
  helpSent,
  helpSending,
  onSend,
  onClose,
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5 shadow-xl">
        {helpFailed ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle size={30} color="#DC2626" strokeWidth={2} />
            </div>
            <p className="text-red-700 font-bold text-lg">Text alert failed</p>
            <p className="text-gray-600 text-base leading-relaxed">
              Please call your family directly to let them know you need help.
            </p>
            <a
              href="tel:911"
              className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg text-center block"
            >
              Call 911
            </a>
            <button
              onClick={onClose}
              className="w-full py-4 rounded-xl bg-gray-200 text-gray-600 font-semibold text-base"
            >
              Close
            </button>
          </div>
        ) : helpSent ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle size={48} color="#16A34A" strokeWidth={1.5} />
            <p className="text-green-700 font-bold text-lg">Your family has been alerted.</p>
            <p className="text-gray-500 text-base leading-relaxed">
              Do you also need emergency services?
            </p>
            <a
              href="tel:911"
              className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg text-center block"
            >
              Call 911
            </a>
            <button
              onClick={onClose}
              className="w-full py-4 rounded-xl bg-gray-200 text-gray-600 font-semibold text-base"
            >
              I don't need 911 — go back home
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={30} color="#DC2626" strokeWidth={2} />
              </div>
              <h2 className="text-[#1B365D] font-bold text-xl">Are you sure?</h2>
              <p className="text-gray-500 text-base leading-relaxed">
                This will send an urgent alert to your entire family.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={onSend}
                disabled={helpSending}
                className="w-full py-4 rounded-xl bg-[#B5483F] text-white font-bold text-lg disabled:opacity-60"
              >
                {helpSending ? 'Sending...' : 'Yes, Send Alert'}
              </button>
              <button
                onClick={onClose}
                disabled={helpSending}
                className="w-full py-4 rounded-xl bg-gray-300 text-gray-700 font-semibold text-lg disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
