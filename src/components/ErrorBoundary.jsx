import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          backgroundColor: '#FAF8F4',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            backgroundColor: '#1B365D', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 24, fontSize: 28,
          }}>
            ⚠️
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B365D', margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 16, color: '#6B7280', margin: '0 0 24px', maxWidth: 360 }}>
            We hit an unexpected error. Please reload the app and try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 32px',
              borderRadius: 12,
              backgroundColor: '#1B365D',
              color: '#D4A843',
              fontSize: 16,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
