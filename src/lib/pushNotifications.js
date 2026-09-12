import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'

let registeredFor = null

// ---------------------------------------------------------------------------
// Web push (2026-09-12). The browser's push service delivers the same
// notifications the store apps get, at no cost per message. Chrome, Edge,
// Firefox and Safari on a Mac take it in the tab; an iPhone only once the app
// is on the Home Screen (Safari exposes PushManager only there). The
// subscription is stored as JSON in user_profile.device_token with
// device_platform 'web', the same one-device-per-person row the store token
// uses; send-push-notification reads it and pushes through the browser's
// service. The private half of this key pair lives in Supabase secrets.
// ---------------------------------------------------------------------------
export const VAPID_PUBLIC_KEY = 'BKA_xXMdvlaypqq2rZ-son3ewVvZcR-q4_ZALQUIEiX2LPkdMBINTYsfslXmOhHleh0FGttgQDTRUEtHmS6d8d8'
const WEB_PUSH_DISMISS_KEY = 'h365_webpush_dismissed_at'
const WEB_PUSH_DISMISS_DAYS = 14

export function webPushSupport() {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return { supported: false, permission: 'unsupported' }
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext
  return { supported, permission: supported ? Notification.permission : 'unsupported' }
}

export function webPushPromptDismissed() {
  try {
    const at = Number(localStorage.getItem(WEB_PUSH_DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < WEB_PUSH_DISMISS_DAYS * 86400000
  } catch { return false }
}

export function dismissWebPushPrompt() {
  try { localStorage.setItem(WEB_PUSH_DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
}

function urlBase64ToUint8Array(s) {
  const padded = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function saveWebSubscription(userId, sub) {
  const { error } = await supabase
    .from('user_profile')
    .update({ device_token: JSON.stringify(sub.toJSON()), device_platform: 'web' })
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

// The worker is registered by main.jsx on window load, in production builds
// only. On a first visit the dashboard can load before that registration has
// an active worker, so wait for it (bounded: in dev there is no worker at all
// and `ready` would never resolve).
async function getWorker(timeoutMs = 10000) {
  const reg = await navigator.serviceWorker.getRegistration()
  if (reg?.active) return reg
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

async function subscribeInWorker(userId) {
  const reg = await getWorker()
  if (!reg) return false
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    // Chrome's subscribe() can stall right after the worker activates, so it
    // gets a bounded wait and one retry a few seconds later.
    const attempt = () => Promise.race([
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('subscribe timed out')), 12000)),
    ])
    try {
      sub = await attempt()
    } catch {
      await new Promise(r => setTimeout(r, 4000))
      sub = await attempt()
    }
  }
  await saveWebSubscription(userId, sub)
  return true
}

// Silent, on every dashboard load: if this browser already said yes, keep the
// row current (subscriptions rotate, and a sign-in as someone else must move
// the subscription to their row).
export async function syncWebPush(userId) {
  const s = webPushSupport()
  if (!s.supported || s.permission !== 'granted') return false
  // Not in the first breath of the page: let the worker and the push service settle.
  await new Promise(r => setTimeout(r, 3000))
  try {
    const done = await subscribeInWorker(userId)
    return done
  } catch (err) { console.warn('Web push sync failed:', err?.message); return false }
}

// From a tap on "Turn on notifications". Browsers only show the permission
// prompt inside a user gesture, so this is never called on load.
export async function enableWebPush(userId) {
  const s = webPushSupport()
  if (!s.supported) return { ok: false, reason: 'unsupported' }
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, reason: perm }
    const done = await subscribeInWorker(userId)
    return done ? { ok: true } : { ok: false, reason: 'no-worker' }
  } catch (err) {
    return { ok: false, reason: err?.message || 'failed' }
  }
}

/**
 * Request push notification permissions and register the device token.
 * Should be called once after the user lands on the dashboard.
 * On the web it only refreshes an existing subscription; the first opt-in
 * comes from the dashboard card (enableWebPush).
 */
export async function registerPushNotifications(userId) {
  // Once per signed-in user, not once per app launch: signing out and back in
  // as someone else on the same phone must save the token to the new row.
  if (registeredFor === userId) return
  if (!Capacitor.isNativePlatform()) {
    registeredFor = userId
    syncWebPush(userId)
    return
  }

  try {
    const permResult = await PushNotifications.requestPermissions()
    if (permResult.receive !== 'granted') {
      console.log('Push permission denied')
      return
    }

    // Android 8+ needs a channel or the system drops the notification. The
    // server sends channel_id 'seniorsafe' (send-push-notification).
    if (Capacitor.getPlatform() === 'android') {
      try {
        await PushNotifications.createChannel({
          id: 'seniorsafe',
          name: 'Hammock365 alerts',
          description: 'Check-ins, missed check-ins, medication and family messages',
          importance: 5,
          visibility: 1,
          sound: 'default',
          vibration: true,
        })
      } catch (chErr) {
        console.warn('Push channel setup failed:', chErr)
      }
    }

    // Listeners go on BEFORE register(): the registration event can fire
    // before an await returns, and a missed event means no token is saved.
    await PushNotifications.removeAllListeners()
    PushNotifications.addListener('registration', async (token) => {
      console.log('Push token received')
      registeredFor = userId

      const platform = Capacitor.getPlatform() // 'ios' or 'android'
      const { error } = await supabase
        .from('user_profile')
        .update({ device_token: token.value, device_platform: platform })
        .eq('user_id', userId)
      if (error) console.error('Push token save failed:', error.message)
    })

    PushNotifications.addListener('registrationError', (error) => {
      console.error('Push registration error:', JSON.stringify(error))
    })

    // Handle incoming notifications while app is in foreground
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Push received:', notification)
    })

    // Handle notification tap (app opened from notification)
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('Push action:', action)
      const data = action.notification?.data
      if (data?.route) {
        window.location.href = data.route
      }
    })

    await PushNotifications.register()
  } catch (err) {
    console.error('Push setup error:', err)
  }
}
