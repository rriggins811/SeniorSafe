export const isNative = () => {
  try {
    return window.Capacitor?.isNativePlatform?.() ?? false
  } catch {
    return false
  }
}

export const isIOS = () => {
  try {
    return window.Capacitor?.getPlatform?.() === 'ios'
  } catch {
    return false
  }
}
