import { useState, useEffect } from 'react'
import { Keyboard } from '@capacitor/keyboard'
import { Capacitor } from '@capacitor/core'

export default function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const showListener = Keyboard.addListener('keyboardWillShow', (info) => {
      setKeyboardHeight(info.keyboardHeight)
    })
    const hideListener = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0)
    })

    return () => {
      showListener.then(h => h.remove()).catch(() => {})
      hideListener.then(h => h.remove()).catch(() => {})
    }
  }, [])

  return keyboardHeight
}
