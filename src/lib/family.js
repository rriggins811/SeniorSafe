import { supabase } from './supabase'
import { sendSMS } from './sms'
import { getAppUrl } from './platform'

// One place that answers "who is in this family and which of them is the
// senior". Every screen that shows family state loads this instead of
// re-deriving it from role / invited_by.
//
// Family key = COALESCE(invited_by, user_id), the same expression the RLS
// helper is_family_member() uses. The owner (role 'admin') holds the family
// code and the subscription. Exactly one row per family has is_senior = true:
// the owner when someone set up for themselves, a member row when an adult
// child set up first and invited the senior.
export async function loadFamily(userId) {
  const { data: me } = await supabase
    .from('user_profile')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (!me) return null

  const ownerId = me.invited_by || me.user_id
  const { data: rows } = await supabase
    .from('user_profile')
    .select('user_id, first_name, last_name, phone, role, invited_by, is_senior, senior_name, senior_phone, family_name, family_code, subscription_tier, checkin_alert_time, timezone, device_token, created_at')
    .or(`user_id.eq.${ownerId},invited_by.eq.${ownerId}`)

  const all = rows || []
  const owner = all.find(r => r.user_id === ownerId) || (me.user_id === ownerId ? me : null)
  const senior = all.find(r => r.is_senior) || null
  const others = all.filter(r => r.user_id !== userId)
  const tier = owner?.subscription_tier || me.subscription_tier || 'free'

  return {
    me,
    ownerId,
    owner,
    senior,
    all,
    others,
    tier,
    isSenior: !!me.is_senior,
    isOwner: me.user_id === ownerId,
    familyName: owner?.family_name || me.family_name || '',
    familyCode: owner?.family_code || me.family_code || '',
    // The senior's first name if they have joined, else what the owner typed at setup.
    seniorName: senior?.first_name || owner?.senior_name || me.senior_name || '',
    seniorPhone: senior?.phone || owner?.senior_phone || '',
    checkinAlertTime: owner?.checkin_alert_time || '09:00',
  }
}

// Invite links. The senior link opens straight to "Hi Margaret" with nothing
// to type but an email and password. The member link is for siblings and
// other family.
export function seniorInviteLink(code) {
  return `${getAppUrl()}/signup?code=${code}&who=senior`
}
export function memberInviteLink(code) {
  return `${getAppUrl()}/signup?code=${code}`
}

export function seniorInviteText({ seniorName, ownerFirstName, code }) {
  const who = ownerFirstName || 'Your family'
  return `Hi ${seniorName || 'there'}, it's ${who}. I set up SeniorSafe so you can let me know you're okay each morning with one tap. Open this link on your phone and follow the steps: ${seniorInviteLink(code)}`
}
export function memberInviteText({ seniorName, code }) {
  const whom = seniorName ? `${seniorName}'s` : 'our family’s'
  return `Join ${whom} SeniorSafe family so you get the daily "I'm okay" check-in too. Tap this link and sign up: ${memberInviteLink(code)}`
}

// sms: link that opens the phone's Messages app with the text filled in.
// "?&body=" is the form both iOS and Android honor.
export function smsHref(phone, body) {
  const digits = (phone || '').replace(/\D/g, '')
  const to = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : digits
  return `sms:${to}?&body=${encodeURIComponent(body)}`
}

export function telHref(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
  return `tel:${digits}`
}

// Push + SMS to a list of family rows (anyone except the sender).
export async function notifyFamily(rows, { title, body, type, sms }) {
  const targets = (rows || []).filter(r => r && r.user_id)
  if (targets.length === 0) return { pushed: 0, texted: 0 }

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_ids: targets.map(r => r.user_id),
          title,
          body,
          notification_type: type,
          sms_fallback_message: sms || null,
          data: { route: '/dashboard' },
        }),
      })
    }
  } catch (err) {
    console.error('Push notification error:', err)
  }

  let texted = 0
  if (sms) {
    const withPhone = targets.filter(r => r.phone && r.phone.trim())
    const results = await Promise.all(withPhone.map(r => sendSMS(r.phone, sms)))
    texted = results.filter(Boolean).length
  }
  return { pushed: targets.length, texted }
}
