import { supabase } from './supabase'

const EDGE_FN_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/send-sms'

export async function sendSMS(to, message) {
  if (!to || !message) return false
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return false

    const res = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ to, message }),
    })
    return res.ok
  } catch (_) {
    return false
  }
}
