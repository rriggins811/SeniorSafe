import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Meta Ads driver. Reuses META_CAPI_ACCESS_TOKEN (SYSTEM_USER token w/ ads_management).
// Direct to Graph Marketing API. Auth-gated via x-proxy-secret == SOCIAL_PROXY_SECRET.
// Actions: account_info | insights | list_campaigns | list_adsets | list_ads | ad_urls | ad_review | set_status | set_budget | create_ad
//   build chain (all PAUSED by default): create_campaign | create_adset | upload_image | create_image_creative | create_ad

const V = 'v20.0'
const DEFAULT_ACCT = '777855301466126'
const GRAPH = `https://graph.facebook.com/${V}`
function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }) }
function safeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

async function gget(path: string, token: string) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`)
  const b = await r.json()
  return { http: r.status, ok: !b.error, error: b.error?.message, body: b }
}
async function gpost(path: string, token: string, fields: Record<string, string>) {
  const body = new URLSearchParams({ ...fields, access_token: token })
  const r = await fetch(`${GRAPH}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const b = await r.json()
  return { http: r.status, ok: !b.error, error: b.error?.message, body: b }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return j({ error: 'POST only' }, 405)
  // Read either case: the project secret is stored lowercase (social_proxy_secret).
  // Reading only the uppercase name left this gate DORMANT = open relay. Match
  // ghl-social-schedule, which reads both, so the existing secret activates the gate.
  const proxySecret = Deno.env.get('SOCIAL_PROXY_SECRET') || Deno.env.get('social_proxy_secret') || ''
  if (proxySecret) {
    const provided = req.headers.get('x-proxy-secret') || ''
    if (!provided || !safeEqual(provided, proxySecret)) return j({ error: 'Unauthorized' }, 401)
  } else { console.warn('[meta-ads] SOCIAL_PROXY_SECRET not set — gate dormant') }

  const token = Deno.env.get('META_CAPI_ACCESS_TOKEN') || ''
  if (!token) return j({ error: 'META_CAPI_ACCESS_TOKEN not set' }, 500)
  let payload: { action?: string; params?: Record<string, any> }
  try { payload = await req.json() } catch { return j({ error: 'invalid JSON' }, 400) }
  const action = payload.action
  const p = payload.params ?? {}
  const acct = p.account_id || DEFAULT_ACCT

  try {
    if (action === 'account_info') return j(await gget(`/act_${acct}?fields=name,account_status,amount_spent,balance,currency,spend_cap`, token))
    if (action === 'insights') {
      const level = p.level || 'account'; const preset = p.date_preset || 'last_7d'
      const fields = p.fields || 'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type'
      const obj = p.object_id || `act_${acct}`; const extra = level === 'account' ? '' : `&level=${level}`
      return j(await gget(`/${obj}/insights?fields=${encodeURIComponent(fields)}&date_preset=${preset}${extra}&limit=${p.limit || 50}`, token))
    }
    if (action === 'list_campaigns') {
      const sf = p.status ? `&effective_status=["${p.status}"]` : ''
      return j(await gget(`/act_${acct}/campaigns?fields=name,status,effective_status,objective,daily_budget,lifetime_budget,start_time&limit=${p.limit || 25}${sf}`, token))
    }
    if (action === 'list_adsets') {
      const parent = p.campaign_id ? `/${p.campaign_id}` : `/act_${acct}`
      return j(await gget(`${parent}/adsets?fields=name,status,effective_status,daily_budget,lifetime_budget,optimization_goal&limit=${p.limit || 25}`, token))
    }
    if (action === 'list_ads') {
      const parent = p.adset_id ? `/${p.adset_id}` : `/act_${acct}`
      return j(await gget(`${parent}/ads?fields=name,status,effective_status&limit=${p.limit || 50}`, token))
    }
    if (action === 'ad_urls') {
      // pulls each active ad's creative destination URL(s) to check UTM/attribution
      const parent = p.adset_id ? `/${p.adset_id}` : `/act_${acct}`
      return j(await gget(`${parent}/ads?fields=name,effective_status,creative{object_story_spec,asset_feed_spec,url_tags,link_destination_display_url,effective_object_story_id,template_url}&limit=${p.limit || 50}`, token))
    }
    if (action === 'ad_review') {
      // exact rejection reasons for a disapproved ad
      if (!p.id) return j({ ok: false, error: 'need id' }, 400)
      return j(await gget(`/${p.id}?fields=name,status,effective_status,issues_info,ad_review_feedback`, token))
    }
    if (action === 'set_status') {
      if (!p.id || !p.status) return j({ ok: false, error: 'need id + status' }, 400)
      return j(await gpost(`/${p.id}`, token, { status: p.status }))
    }
    if (action === 'set_budget') {
      if (!p.id) return j({ ok: false, error: 'need id' }, 400)
      const f: Record<string, string> = {}
      if (p.daily_budget_cents) f.daily_budget = String(p.daily_budget_cents)
      if (p.lifetime_budget_cents) f.lifetime_budget = String(p.lifetime_budget_cents)
      if (!Object.keys(f).length) return j({ ok: false, error: 'need budget' }, 400)
      return j(await gpost(`/${p.id}`, token, f))
    }
    if (action === 'create_ad') {
      // Creates an ad shell pointing at an EXISTING creative. Always defaults to PAUSED.
      if (!p.name || !p.adset_id || !p.creative_id) return j({ ok: false, error: 'need name + adset_id + creative_id' }, 400)
      const f: Record<string, string> = {
        name: String(p.name),
        adset_id: String(p.adset_id),
        creative: JSON.stringify({ creative_id: String(p.creative_id) }),
        status: p.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      }
      if (p.tracking_specs) f.tracking_specs = JSON.stringify(p.tracking_specs)
      return j(await gpost(`/act_${acct}/ads`, token, f))
    }
    if (action === 'create_campaign') {
      // Always PAUSED. special_ad_categories defaults to [] (not housing/credit/employment/etc).
      if (!p.name || !p.objective) return j({ ok: false, error: 'need name + objective' }, 400)
      const f: Record<string, string> = {
        name: String(p.name),
        objective: String(p.objective),
        status: p.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
        special_ad_categories: JSON.stringify(p.special_ad_categories ?? []),
      }
      if (p.buying_type) f.buying_type = String(p.buying_type)
      const r = await gpost(`/act_${acct}/campaigns`, token, f)
      return j({ ...r, campaign_id: r.body?.id })
    }
    if (action === 'create_adset') {
      // Conversion ad set. Always PAUSED. billing_event defaults to IMPRESSIONS.
      // promoted_object carries { pixel_id, custom_event_type } for conversion optimization.
      if (!p.name || !p.campaign_id || !p.daily_budget || !p.optimization_goal || !p.targeting)
        return j({ ok: false, error: 'need name + campaign_id + daily_budget + optimization_goal + targeting' }, 400)
      const f: Record<string, string> = {
        name: String(p.name),
        campaign_id: String(p.campaign_id),
        daily_budget: String(p.daily_budget), // minor units (cents)
        billing_event: String(p.billing_event || 'IMPRESSIONS'),
        optimization_goal: String(p.optimization_goal),
        targeting: JSON.stringify(p.targeting),
        status: p.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      }
      if (p.promoted_object) f.promoted_object = JSON.stringify(p.promoted_object)
      if (p.bid_amount) f.bid_amount = String(p.bid_amount)
      if (p.bid_strategy) f.bid_strategy = String(p.bid_strategy)
      if (p.start_time) f.start_time = String(p.start_time)
      if (p.end_time) f.end_time = String(p.end_time)
      const r = await gpost(`/act_${acct}/adsets`, token, f)
      return j({ ...r, adset_id: r.body?.id })
    }
    if (action === 'upload_image') {
      // Upload an ad image by base64 bytes; surfaces the image_hash for the creative.
      if (!p.bytes) return j({ ok: false, error: 'need bytes (base64 image)' }, 400)
      const r = await gpost(`/act_${acct}/adimages`, token, { bytes: String(p.bytes) })
      // /adimages returns { images: { <name>: { hash, url } } } — pull the first hash.
      let image_hash: string | undefined
      try {
        const imgs = r.body?.images
        if (imgs && typeof imgs === 'object') image_hash = (Object.values(imgs)[0] as any)?.hash
      } catch { /* leave undefined */ }
      return j({ ...r, image_hash })
    }
    if (action === 'create_image_creative') {
      // Single-image link creative. Returns creative_id for create_ad to attach.
      // call_to_action: pass a type string (e.g. "LEARN_MORE") or a full { type, value } object.
      if (!p.page_id || !p.image_hash || !p.link)
        return j({ ok: false, error: 'need page_id + image_hash + link' }, 400)
      const link_data: Record<string, any> = { image_hash: String(p.image_hash), link: String(p.link) }
      if (p.message) link_data.message = String(p.message)
      if (p.name) link_data.name = String(p.name)               // headline
      if (p.description) link_data.description = String(p.description)
      if (p.call_to_action) {
        link_data.call_to_action = typeof p.call_to_action === 'string'
          ? { type: p.call_to_action, value: { link: String(p.link) } }
          : p.call_to_action
      }
      const f: Record<string, string> = {
        object_story_spec: JSON.stringify({ page_id: String(p.page_id), link_data }),
      }
      f.name = String(p.creative_name || p.name || 'Map creative')
      if (p.degrees_of_freedom_spec) f.degrees_of_freedom_spec = JSON.stringify(p.degrees_of_freedom_spec)
      const r = await gpost(`/act_${acct}/adcreatives`, token, f)
      return j({ ...r, creative_id: r.body?.id })
    }
    return j({ error: `unknown action: ${action}` }, 400)
  } catch (e) { return j({ error: e instanceof Error ? e.message : 'unknown' }, 500) }
})
