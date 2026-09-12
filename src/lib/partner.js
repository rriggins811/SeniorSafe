import { supabase } from './supabase'
import { getPartnerCode } from './attribution'

// Partner co-branding, Level 1 ("Shared by"). Added 2026-09-12.
// A partner is a row in the partners table. The family OWNER's profile carries
// partner_code; everyone in the family sees the owner's partner through
// loadFamily(). Everything the client reads goes through the lookup_partner
// RPC, which returns active rows and public columns only.

export const PARTNER_CODE_WINDOW_DAYS = 30
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/
const TTL_MS = 10 * 60 * 1000
const cache = new Map() // code -> { at, partner }

export function normalizePartnerCode(s) {
  return (s || '').trim().toLowerCase()
}

export async function lookupPartner(code) {
  const c = normalizePartnerCode(code)
  if (!CODE_RE.test(c)) return null
  const hit = cache.get(c)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.partner
  const { data, error } = await supabase.rpc('lookup_partner', { p_code: c })
  if (error) return null
  const partner = data?.[0] || null
  cache.set(c, { at: Date.now(), partner })
  return partner
}

// The code a brand-new owner profile should carry: what they typed at signup
// if it is real, else what the partner link left behind, else nothing. A bad
// code is dropped here and again by the insert trigger; signup never fails
// over it.
export async function resolvePartnerCode(typed) {
  for (const c of [typed, getPartnerCode()]) {
    if (!c) continue
    const p = await lookupPartner(c)
    if (p) return p.code
  }
  return null
}

// Owners can add a code in Settings for 30 days after signup. This is the
// store-install gap: someone who installed from the App Store or Play never
// carried the link, so they type the code from the partner's flyer.
export function canAddPartnerCode(profile) {
  if (!profile || profile.role !== 'admin' || profile.partner_code) return false
  const created = new Date(profile.created_at).getTime()
  return Number.isFinite(created) && Date.now() - created < PARTNER_CODE_WINDOW_DAYS * 86400000
}

const OUR_MESSAGES = [
  'We could not find that code.',
  'This family already has a partner code.',
  'A partner code can be added only in the first 30 days.',
  'Only the person who set up the family can add a partner code.',
  'Please sign in again.',
]

export async function addPartnerCode(code) {
  const c = normalizePartnerCode(code)
  if (!CODE_RE.test(c)) return { error: 'We could not find that code.' }
  const { data, error } = await supabase.rpc('set_partner_code', { p_code: c })
  if (error) {
    const known = OUR_MESSAGES.find(m => (error.message || '').includes(m))
    return { error: known || 'That did not go through. Please try again.' }
  }
  const partner = data?.[0] || null
  if (partner) cache.set(c, { at: Date.now(), partner })
  return { partner }
}

export function formatPartnerPhone(phone) {
  const d = (phone || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone || ''
}
