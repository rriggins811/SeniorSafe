import { supabase } from './supabase'

// Funnel events for the dashboard: lock taps, upgrade views, checkout starts.
// Fire and forget; a failure here must never block the screen.
export async function logFunnel(event, feature = null, meta = null) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('funnel_events').insert({ user_id: user.id, event, feature, meta })
  } catch {
    /* ignore */
  }
}
