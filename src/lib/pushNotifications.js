import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'

let registered = false

/**
 * Request push notification permissions and register the device token.
 * Should be called once after the user lands on the dashboard.
 * No-op on web.
 */
export async function registerPushNotifications(userId) {
  if (registered) return
  if (!Capacitor.isNativePlatform()) return

  try {
    const permResult = await PushNotifications.requestPermissions()
    if (permResult.receive !== 'granted') {
      console.log('Push permission denied')
      return
    }

    await PushNotifications.register()

    PushNotifications.addListener('registration', async (token) => {
      console.log('Push token:', token.value)
      registered = true

      const platform = Capacitor.getPlatform() // 'ios' or 'android'
      await supabase
        .from('user_profile')
        .update({ device_token: token.value, device_platform: platform })
        .eq('user_id', userId)
    })

    PushNotifications.addListener('registrationError', (error) => {
      console.error('Push registration error:', error)
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
  } catch (err) {
    console.error('Push setup error:', err)
  }
}
