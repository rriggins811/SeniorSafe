const EDGE_FN_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/send-sms'

export async function sendSMS(to, message) {
  if (!to || !message) return false
  try {
    const res = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message }),
    })
    return res.ok
  } catch (_) {
    return false
  }
}
