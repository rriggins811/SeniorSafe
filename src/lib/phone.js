// Phone helpers for the family contact number. The free plan's one text
// goes to this number, so it has to be a real US mobile, not a placeholder.

export function digitsOf(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d
}

// Returns '' when the number looks like a real US mobile, otherwise a short
// reason in plain words. Placeholder patterns (555-01xx, 123-456-7890,
// 000-000-0000) are rejected because a text to them goes nowhere.
export function phoneProblem(phone) {
  const d = digitsOf(phone)
  if (!d) return 'Enter a mobile number.'
  if (d.length !== 10) return 'A US mobile number has 10 digits.'
  const area = d.slice(0, 3)
  const exchange = d.slice(3, 6)
  if (/^[01]/.test(area) || /^[01]/.test(exchange)) return 'That does not look like a real number.'
  if (area[1] === '1' && area[2] === '1') return 'That does not look like a real number.'
  if (exchange === '555') return 'That looks like a placeholder number, not a real one.'
  if (/^(\d)\1{9}$/.test(d)) return 'That looks like a placeholder number, not a real one.'
  if (d === '1234567890' || d === '0123456789' || d === '2345678901') return 'That looks like a placeholder number, not a real one.'
  return ''
}

export function isRealMobile(phone) {
  return phoneProblem(phone) === ''
}
