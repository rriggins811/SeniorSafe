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

export const isAndroid = () => {
  try {
    return window.Capacitor?.getPlatform?.() === 'android'
  } catch {
    return false
  }
}

export const openExternalLink = (url) => {
  if (isNative() && window.Capacitor?.Plugins?.Browser) {
    window.Capacitor.Plugins.Browser.open({ url })
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export const getAppUrl = () => {
  try {
    const origin = window.location.origin
    if (origin.includes('capacitor://') || origin.includes('localhost')) {
      return 'https://app.seniorsafeapp.com'
    }
    return origin
  } catch {
    return 'https://app.seniorsafeapp.com'
  }
}

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback: prompt user to copy manually
    window.prompt('Copy this text:', text)
    return false
  }
}
