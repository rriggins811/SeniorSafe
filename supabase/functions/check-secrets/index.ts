import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Retired 2026-05-29. This was a debug helper that leaked secret length +
// prefix to unauthenticated callers (flagged in security audit). Neutralized
// to disclose nothing. Safe to delete entirely from the dashboard.
serve(() =>
  new Response(JSON.stringify({ error: 'gone' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })
)
