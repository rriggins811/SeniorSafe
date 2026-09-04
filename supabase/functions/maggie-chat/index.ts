import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Retired 2026-09-04. Maggie now lives at /functions/v1/ai-chat (one assistant
// for everyone; see supabase/functions/ai-chat). This stub answers old app
// builds with a clear message and logs each call so we can see when the last
// old client goes away. Delete the function after 2026-10-04.

const ALLOWED_ORIGINS = [
  'https://app.seniorsafeapp.com',
  'https://senior-safe-hazel.vercel.app',
  'http://localhost:5173',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]

serve((req) => {
  const origin = req.headers.get('Origin') || ''
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  console.warn('[MAGGIE-CHAT-RETIRED]', { ua: req.headers.get('User-Agent') || 'unknown', ts: new Date().toISOString() })
  return new Response(JSON.stringify({
    error: 'moved',
    message: 'Maggie moved. Please update the SeniorSafe app, then try again.',
    endpoint: '/functions/v1/ai-chat',
  }), { status: 410, headers })
})
