import { supabase } from './supabase'

// Ambiguity-free charset: no I/O/1/0 (easier to share verbally)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Crypto-secure 6-char code
function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, b => CHARS[b % CHARS.length]).join('')
}

// Generate a unique family code (retries on collision)
export async function generateFamilyCode() {
  for (let i = 0; i < 5; i++) {
    const code = generateCode()
    const { data } = await supabase
      .from('user_profile')
      .select('user_id')
      .eq('family_code', code)
      .maybeSingle()
    if (!data) return code
  }
  throw new Error('Could not generate unique family code')
}
