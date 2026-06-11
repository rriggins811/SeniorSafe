// RETIRED 2026-06-11 (security audit #13).
// The newsletter moved to GoHighLevel; this endpoint was a mass-email relay
// reachable with the public anon key and a full-access Resend key, with no
// per-caller check or rate limit. Replaced with a 410 stub so the open relay is
// gone. The original implementation is in git history. TODO (Ryan): revoke the
// now-unused full-access Resend (RESEND_AUDIENCES_API_KEY) key.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(() =>
  new Response(
    JSON.stringify({ error: "This endpoint has been retired. Newsletter sending now runs through GoHighLevel." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
)
