import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isNative } from './lib/platform'
import { captureAttribution } from './lib/attribution'

// Capture ad attribution (fbclid + UTMs) on first load, before React renders.
captureAttribution()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register service worker (web only — not needed in Capacitor)
if (!isNative() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app works fine without it
    })
  })
}
