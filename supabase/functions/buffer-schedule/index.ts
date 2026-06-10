import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const BUFFER_API = 'https://api.buffer.com'
const channelServiceCache = new Map<string, string>()

async function bufferGraphQL(query: string, variables: Record<string, unknown> | undefined, token: string) {
  const res = await fetch(BUFFER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ query, variables: variables ?? {} }),
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json()
  return { status: res.status, body: json }
}

async function fetchAllChannels(token: string) {
  const orgQuery = `query { account { organizations { id name } } }`
  const orgResp = await bufferGraphQL(orgQuery, undefined, token)
  if (orgResp.status !== 200 || orgResp.body?.errors) return { ok: false, step: 'fetch_org', http_status: orgResp.status, response: orgResp.body }
  const orgs = orgResp.body?.data?.account?.organizations
  if (!orgs || orgs.length === 0) return { ok: false, step: 'fetch_org', error: 'No organizations' }
  const org = orgs[0]
  const chanQuery = `query GetChannels($orgId: OrganizationId!) { channels(input: { organizationId: $orgId }) { id name service } }`
  const chanResp = await bufferGraphQL(chanQuery, { orgId: org.id }, token)
  if (chanResp.status !== 200 || chanResp.body?.errors) return { ok: false, step: 'fetch_channels', http_status: chanResp.status, response: chanResp.body }
  const channels = chanResp.body?.data?.channels ?? []
  for (const ch of channels) { if (ch?.id && ch?.service) channelServiceCache.set(ch.id, ch.service) }
  return { ok: true, organization: { id: org.id, name: org.name }, channels }
}

async function listChannels(token: string) { return await fetchAllChannels(token) }

async function resolveService(channelId: string, token: string, providedService?: string): Promise<{ ok: true; service: string } | { ok: false; error: string }> {
  if (providedService && typeof providedService === 'string') return { ok: true, service: providedService.toLowerCase() }
  const cached = channelServiceCache.get(channelId)
  if (cached) return { ok: true, service: cached }
  const result = await fetchAllChannels(token)
  if (!result.ok) return { ok: false, error: `Could not resolve service for channel ${channelId}: channel list fetch failed` }
  const service = channelServiceCache.get(channelId)
  if (!service) return { ok: false, error: `Channel ${channelId} not found` }
  return { ok: true, service }
}

async function getPost(postId: string, token: string) {
  const query = `query GetPost($input: PostInput!) { post(input: $input) { id text dueAt channelId status metadata { __typename ... on FacebookPostMetadata { type firstComment } ... on InstagramPostMetadata { type firstComment shouldShareToFeed } ... on LinkedInPostMetadata { firstComment } } } }`
  const resp = await bufferGraphQL(query, { input: { id: postId } }, token)
  if (resp.status !== 200 || resp.body?.errors) return { ok: false, http_status: resp.status, response: resp.body }
  return { ok: true, post: resp.body?.data?.post }
}

async function deletePost(postId: string, token: string) {
  // Buffer's deletePost returns a DeletePostPayload union (DeletePostSuccess | VoidMutationError)
  const mutation = `mutation DeletePost($input: DeletePostInput!) { deletePost(input: $input) { __typename ... on DeletePostSuccess { id } ... on VoidMutationError { message } } }`
  const resp = await bufferGraphQL(mutation, { input: { id: postId } }, token)
  if (resp.status !== 200 || resp.body?.errors) return { ok: false, http_status: resp.status, response: resp.body }
  const result = resp.body?.data?.deletePost
  if (result?.__typename === 'VoidMutationError') return { ok: false, mutation_error: result.message }
  return { ok: true, deleted_post_id: result?.id ?? postId }
}

async function schedulePost(token: string, params: { channel_id: string; content: string; scheduled_time?: string; image_url?: string; image_urls?: string[]; first_comment?: string; service?: string; post_type?: string }) {
  const { channel_id, content, scheduled_time, image_url, image_urls, first_comment, service: providedService, post_type } = params
  if (!channel_id) return { ok: false, error: 'Missing channel_id' }
  if (!content) return { ok: false, error: 'Missing content' }
  const serviceResult = await resolveService(channel_id, token, providedService)
  if (!serviceResult.ok) return { ok: false, error: serviceResult.error }
  const service = serviceResult.service

  const urls: string[] = Array.isArray(image_urls) && image_urls.length > 0
    ? image_urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : (typeof image_url === 'string' && image_url.length > 0 ? [image_url] : [])

  let metadataField = ''
  if (service === 'facebook') {
    const fbType = (post_type || 'post').toLowerCase()
    const fbFields: string[] = [`type: ${fbType}`]
    if (first_comment) fbFields.push(`firstComment: $firstComment`)
    metadataField = `, metadata: { facebook: { ${fbFields.join(', ')} } }`
  } else if (service === 'instagram') {
    const igType = (post_type || 'post').toLowerCase()
    const igFields: string[] = [`type: ${igType}`, `shouldShareToFeed: true`]
    if (first_comment) igFields.push(`firstComment: $firstComment`)
    metadataField = `, metadata: { instagram: { ${igFields.join(', ')} } }`
  } else if (service === 'linkedin') {
    if (first_comment) metadataField = `, metadata: { linkedin: { firstComment: $firstComment } }`
  }

  const variables: Record<string, unknown> = { channelId: channel_id, text: content }
  let assetsField = ''
  let assetsVarDecl = ''
  if (urls.length === 1) {
    variables.imageUrl = urls[0]
    assetsField = ', assets: [{ image: { url: $imageUrl } }]'
    assetsVarDecl = '$imageUrl: String!,'
  } else if (urls.length > 1) {
    const declParts: string[] = []
    const assetParts: string[] = []
    urls.forEach((u, i) => {
      const varName = `imageUrl${i + 1}`
      variables[varName] = u
      declParts.push(`$${varName}: String!`)
      assetParts.push(`{ image: { url: $${varName} } }`)
    })
    assetsField = `, assets: [${assetParts.join(', ')}]`
    assetsVarDecl = declParts.join(', ') + ','
  } else {
    assetsField = ', assets: []'
  }

  let firstCommentVarDecl = ''
  if (first_comment) {
    variables.firstComment = first_comment
    firstCommentVarDecl = '$firstComment: String!,'
  }

  let modePart = ''
  let dueAtVarDecl = ''
  if (scheduled_time) {
    variables.dueAt = scheduled_time
    modePart = ', mode: customScheduled, dueAt: $dueAt'
    dueAtVarDecl = '$dueAt: DateTime!'
  } else {
    modePart = ', mode: addToQueue'
  }

  const mutation = `mutation CreatePost($channelId: ChannelId!, $text: String!, ${assetsVarDecl} ${firstCommentVarDecl} ${dueAtVarDecl}) { createPost(input: { channelId: $channelId, text: $text${assetsField}${metadataField}, schedulingType: automatic${modePart} }) { ... on PostActionSuccess { post { id text dueAt } } ... on MutationError { message } } }`

  const resp = await bufferGraphQL(mutation, variables, token)
  if (resp.status !== 200 || resp.body?.errors) return { ok: false, http_status: resp.status, response: resp.body, service_used: service }
  const result = resp.body?.data?.createPost
  if (result?.message) return { ok: false, mutation_error: result.message, service_used: service }
  return { ok: true, post: result?.post, image_count: urls.length, service_used: service }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
  const token = Deno.env.get('BUFFER_ACCESS_TOKEN')
  if (!token || /PLACEHOLDER/i.test(token)) return new Response(JSON.stringify({ error: 'BUFFER_ACCESS_TOKEN not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  let payload: { action?: string; params?: Record<string, unknown> }
  try { payload = await req.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }
  const action = payload.action
  try {
    if (action === 'list_channels') {
      const result = await listChannels(token)
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } })
    } else if (action === 'schedule_post') {
      const params = (payload.params ?? {}) as Record<string, unknown>
      const result = await schedulePost(token, params as Parameters<typeof schedulePost>[1])
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } })
    } else if (action === 'get_post') {
      const params = (payload.params ?? {}) as { post_id?: string }
      if (!params.post_id) return new Response(JSON.stringify({ error: 'Missing post_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      const result = await getPost(params.post_id, token)
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } })
    } else if (action === 'delete_post') {
      const params = (payload.params ?? {}) as { post_id?: string }
      if (!params.post_id) return new Response(JSON.stringify({ error: 'Missing post_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      const result = await deletePost(params.post_id, token)
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } })
    } else {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
