// 30-minute increments, 6 AM to 8 PM. Value is HH:MM 24h, what the cron reads.
export const TIME_OPTIONS = (() => {
  const out = []
  for (let h = 6; h <= 20; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 20 && m > 0) break
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h
      const ampm = h >= 12 ? 'PM' : 'AM'
      out.push({ label: `${hour12}:${String(m).padStart(2, '0')} ${ampm}`, value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` })
    }
  }
  return out
})()

export function formatTime12(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${hour12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
