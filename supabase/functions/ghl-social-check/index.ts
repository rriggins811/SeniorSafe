import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// Retired 2026-05-29. Was a one-time diagnostic to list connected GHL social
// accounts. Job done (ghl-social-schedule function now live).
// Safe to delete entirely from the dashboard.
serve(() => new Response(JSON.stringify({ error: 'gone' }), { status: 410, headers: { 'Content-Type': 'application/json' } }))
