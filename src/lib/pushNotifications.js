import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'

let registeredFor = null

/**
 * Request push notification permissions and register the device token.
 * Should be called once after the user lands on the dashboard.
 * No-op on web.
 */
export async function registerPushNotifications(userId) {
  // Once per signed-in user, not once per app launch: signing out and back in
  // as someone else on the same phone must save the token to the new row.
  if (registeredFor === userId) return
  if (!Capacitor.isNativePlatform()) return

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
