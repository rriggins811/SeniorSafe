import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, message } = await req.json()

    if (!to || !message) {
      return new Response(JSON.stringify({ error: 'to and message are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const GHL_API_KEY = Deno.env.get('GHL_API_KEY')
    const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID')
    const GHL_PHONE_NUMBER = Deno.env.get('GHL_PHONE_NUMBER')

    // Normalize phone to E.164 format
    const digits = to.replace(/\D/g, '')
    const toFormatted = digits.startsWith('1') ? `+${digits}` : `+1${digits}`

    const response = await fetch('https://services.leadconnectorhq.com/conversations/messages/outbound', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
        'Version': '2021-04-15',
      },
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        type: 'SMS',
        message,
        toNumber: toFormatted,
        fromNumber: GHL_PHONE_NUMBER,
      }),
    })

    const data = await response.json()

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: response.ok ? 200 : 400,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
