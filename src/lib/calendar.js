/**
 * Google Calendar URL helper for SeniorSafe.
 * Generates "Add to Google Calendar" links that open in a new tab
 * with event details pre-filled.
 */

/**
 * Format a local datetime string to Google Calendar format (YYYYMMDDTHHMMSS).
 * @param {string} iso — "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS"
 * @returns {string} "YYYYMMDDTHHMMSS"
 */
function fmtGcal(iso) {
  // Remove dashes, colons; ensure seconds
  const clean = iso.replace(/[-:]/g, '')
  // If no seconds provided, append "00"
  return clean.length === 13 ? clean + '00' : clean
}

/**
 * Add minutes to a "HH:MM" time string.
 * @param {string} time — "HH:MM"
 * @param {number} mins — minutes to add
 * @returns {string} "HH:MM"
 */
export function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  const newH = Math.floor(total / 60) % 24
  const newM = total % 60
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`
}

/**
 * Build a Google Calendar "Add Event" URL.
 * Opens calendar.google.com with event details pre-filled.
 *
 * @param {string} title     — event title
 * @param {string} startISO  — "YYYY-MM-DDTHH:MM" (local time)
 * @param {string} endISO    — "YYYY-MM-DDTHH:MM" (local time)
 * @param {string} [details] — event description
 * @param {string} [location] — event location
 * @returns {string} full Google Calendar URL
 */
export function googleCalendarUrl(title, startISO, endISO, details, location) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmtGcal(startISO)}/${fmtGcal(endISO)}`,
  })
  if (details) params.set('details', details)
  if (location) params.set('location', location)
  return `https://calendar.google.com/calendar/render?${params}`
}
