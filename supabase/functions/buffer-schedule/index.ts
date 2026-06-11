// RETIRED 2026-06-11 (security audit #12).
// Social scheduling moved to ghl-social-schedule; this endpoint was an
// UNAUTHENTICATED open relay that could list/publish/delete posts on the brand's
// Facebook/Instagram/LinkedIn channels via the Buffer token. Replaced with a 410
// stub so the open relay is gone. Original implementation is in git history.
// TODO (Ryan): rotate/delete the BUFFER_ACCESS_TOKEN secret.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(() =>
  new Response(
    JSON.stringify({ error: "This endpoint has been retired. Social scheduling now runs through ghl-social-schedule." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
)
