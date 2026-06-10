import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Retired 2026-05-29. Kit (ConvertKit) was fully retired in Phase 6 (May 18).
// This proxy had no live callers and held no token. Neutralized. Safe to
// delete entirely from the dashboard.
serve(() =>
  new Response(JSON.stringify({ error: 'gone' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })
)
