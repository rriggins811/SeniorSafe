// RETIRED 2026-06-11 (security audit #6).
// This uploaded images to the PUBLIC 'marketing-cards' bucket using the service-role
// key with NO caller authentication — any anonymous caller who knew the URL could
// write to the public marketing bucket. Ryan did not recognize an active caller, so
// it's retired as a 410 stub. The original implementation is in git history. If a
// marketing/social-image automation turns out to depend on it, restore from git and
// gate it with x-proxy-secret (the meta-capi-trial fail-closed pattern) instead.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(() =>
  new Response(
    JSON.stringify({ error: "This endpoint has been retired." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
)
