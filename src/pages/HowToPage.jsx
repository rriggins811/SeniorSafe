import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, PlayCircle } from 'lucide-react'

const MEDIA = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/storage/v1/object/public/marketing-cards/2026-09-11/h365'

const VIDEOS = [
  { id: 'invite-link', title: 'How Mom opens her invite link', plan: 'Free', seconds: 24, file: 'howto_07_mom_opens_invite_link_h365.mp4', poster: 'poster_07.jpg',
    steps: ['She taps the link you sent her. No app store, no download.', 'Her name is already there. She types an email and picks a password; do it for her if you are holding her phone.', 'Tap Continue. Her button is waiting.', 'She taps it once, and your phone says she is okay.'] },
  { id: 'medication', title: 'How to add a medication', plan: 'Free', seconds: 27, file: 'howto_08_add_medication_h365.mp4', poster: 'poster_08.jpg',
    steps: ['Tap Medications, then the plus.', 'Name, dose, how often, and what time.', 'Turn on Remind me on my phone. Her phone tells her when it is time, with an I took it button.', 'On the paid plan, if the box is still empty an hour later, the family hears about it.'] },
  { id: 'appointment', title: 'How to add an appointment', plan: 'Paid plan', seconds: 19, file: 'howto_09_add_appointment_h365.mp4', poster: 'poster_09.jpg',
    steps: ['Tap Next appointment, then the plus.', 'Who, and where.', 'Pick the day and the time.', 'Notes are for the family. Tap Add Appointment and everyone can see it.'] },
  { id: 'emergency-card', title: 'How to set up the emergency card', plan: 'Free', seconds: 18, file: 'howto_10_emergency_card_h365.mp4', poster: 'poster_10.jpg',
    steps: ['Tap ER card.', 'Her legal name and her allergies. The medication list fills itself in.', 'Her doctor, and who to call.', 'Save. It is on her phone too, in big type.'] },
  { id: 'family-and-settings', title: 'Inviting family, and your settings', plan: 'Free', seconds: 25, file: 'howto_11_family_invite_and_settings_h365.mp4', poster: 'poster_11.jpg',
    steps: ['Tap the people icon. Text a sibling an invite or share the family code. Everyone who joins sees the board; on the paid plan they get the texts too.', 'Tap the gear for your settings. The mobile number here is the one that gets the text.', 'The check-in time is the deadline. If she has not tapped by then, you hear about it.'] },
]

export default function HowToPage() {
  const navigate = useNavigate()
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(hash.slice(1))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash])

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col pb-10">
      <div className="bg-[#1B365D] px-5 pt-12 pb-5 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-white/70 text-base mb-4"><ArrowLeft size={18} /> Back</button>
          <h1 className="text-white text-xl font-bold">How-to videos</h1>
          <p className="text-white/70 text-base mt-1">Under thirty seconds each. Ryan talks, the phone shows every tap.</p>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full flex flex-col gap-5">
        {VIDEOS.map((v, i) => (
          <section key={v.id} id={v.id} className="bg-white rounded-2xl shadow-sm overflow-hidden scroll-mt-4">
            <video controls playsInline preload="metadata" poster={`${MEDIA}/${v.poster}`} className="w-full bg-[#FAF8F4]">
              <source src={`${MEDIA}/${v.file}`} type="video/mp4" />
            </video>
            <div className="p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1"><PlayCircle size={14} /> {i + 1} of {VIDEOS.length} · {v.plan} · {v.seconds} seconds</p>
              <h2 className="text-[#1B365D] font-bold text-lg mt-1">{v.title}</h2>
              <ol className="mt-2 list-decimal pl-5 text-gray-700 text-base leading-relaxed space-y-1">
                {v.steps.map(s => <li key={s}>{s}</li>)}
              </ol>
            </div>
          </section>
        ))}
        <p className="text-gray-500 text-sm text-center px-2">Still stuck? Call or text Ryan at (336) 553-8933, or email support@hammock365.com.</p>
      </div>
    </div>
  )
}
