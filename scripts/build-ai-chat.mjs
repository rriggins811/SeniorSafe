// Assembles supabase/functions/ai-chat/index.ts from its parts, so the file
// Ryan pastes into the Supabase editor is one self-contained file.
//
//   supabase/prompts/maggie-system-prompt-v2.md   the voice, rules, product facts
//   supabase/prompts/maggie-knowledge-base.md     Blueprint reference, split by "## N." headers
//   src/content/setupFaq.js                       app help (also the Help Center)
//   supabase/functions/ai-chat/index.template.ts  the code, with __PLACEHOLDERS__
//
// Usage: node scripts/build-ai-chat.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { SETUP_FAQ } from '../src/content/setupFaq.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ---- knowledge base -------------------------------------------------------
const kb = read('supabase/prompts/maggie-knowledge-base.md')
const parts = kb.split(/^(?=## )/m).filter(s => s.startsWith('## '))
const byNumber = new Map()
for (const p of parts) {
  const m = p.match(/^## (\d+)\. ([^\n]+)/)
  if (m) byNumber.set(Number(m[1]), { title: m[2].trim(), text: p.trim() })
}

// Always in the cached prefix: the framework every answer uses.
const FRAMEWORK = [2, 3, 4].map(n => byNumber.get(n)?.text || '').join('\n\n')

// Attached per call when the question matches. Keywords are plain words a
// family would actually type. Sections 1, 17, 18, 19 and the appendix are
// covered by the prompt itself.
const KEYWORDS = {
  5:  ['declutter', 'clutter', 'sort', 'sorting', 'downsize', 'downsizing', 'stuff', 'belongings', 'garage', 'attic', 'basement', 'estate sale', 'donate', 'keepsake', 'sentimental', 'pile', 'tidy', 'hoard', 'closet', 'boxes of'],
  6:  ['repair', 'repairs', 'fix', 'contractor', 'handyman', 'grab bar', 'railing', 'stairs', 'roof', 'hvac', 'furnace', 'plumbing', 'electrical', 'renovat', 'must-fix', 'inspection', 'safety hazard', 'ramp'],
  7:  ['power of attorney', 'poa', 'will', 'trust', 'probate', 'estate plan', 'attorney', 'lawyer', 'guardianship', 'beneficiary', 'deed', 'title', 'taxes', 'tax', 'cpa', 'budget', 'afford', 'money', 'exploitation', 'scam', 'bank', 'account', 'spend-down', 'spend down', 'look-back', 'look back'],
  8:  ['assisted living', 'memory care', 'nursing home', 'independent living', 'ccrc', 'community', 'facility', 'tour', 'senior living', 'move-in', 'waitlist', 'skilled nursing', 'rehab'],
  9:  ['sell', 'selling', 'sale', 'list the house', 'listing', 'realtor', 'agent', 'offer', 'cash buyer', 'wholesaler', 'closing', 'appraisal', 'market', 'net proceeds', 'as-is', 'as is', 'investor', 'contract', 'earnest', 'due diligence', 'commission'],
  10: ['move', 'moving', 'movers', 'packing', 'pack', 'moving day', 'floor plan', 'truck', 'relocat', 'move date'],
  11: ['settle', 'settling', 'adjust', 'adjustment', 'lonely', 'new place', 'after the move', 'homesick', 'first week', 'complete loops'],
  12: ['sibling', 'siblings', 'brother', 'sister', 'conversation', 'talk to mom', 'talk to dad', 'resist', 'resistant', 'refuse', 'refuses', "won't", 'wont', 'argue', 'conflict', 'family meeting', 'stubborn', 'denial'],
  13: ['aging in place', 'stay home', 'stay in the house', 'stay in her home', 'stay in his home', 'home care', 'in-home', 'caregiver hours', 'walk-in shower', 'stairlift', 'remain at home', 'live alone'],
  14: ['medicare', 'medicaid', 'va ', 'veteran', 'aid and attendance', 'long-term care insurance', 'ltc', 'part b', 'part a', 'supplement', 'medigap', 'benefits', 'social security', 'premium', 'coverage', 'insurance'],
  15: ['burnout', 'burned out', 'exhausted', 'overwhelmed', 'respite', 'caregiver', 'caregiving', 'guilt', 'guilty', 'self-care', 'support group', 'no help', 'doing it all', 'resent'],
  16: ['blueprint', 'roadmap', 'book', 'books', 'price', 'cost of the app', 'subscription', 'upgrade', 'ryan', 'call with ryan', 'referral', 'refer', 'plan', 'free trial', 'cancel'],
}
const KB_SECTIONS = Object.entries(KEYWORDS).map(([n, keywords]) => {
  const sec = byNumber.get(Number(n))
  if (!sec) throw new Error(`Knowledge base section ${n} not found`)
  return { n: Number(n), title: sec.title, keywords, text: sec.text }
})

// ---- app help -------------------------------------------------------------
const help = ['## App help (how SeniorSafe works; answer these directly)', '']
help.push('One person sets up the family and manages the plan (the owner, usually an adult child). One person is the one who checks in each day (the senior): a big "I\'m Okay Today" button, a red "I Need Help" button, a Menu for family messages, medications, appointments, the emergency card and documents, and an "Ask a question" button that opens you. Everyone else joins as a family member and sees the senior\'s check-in status by name, a 14-day strip, medications, appointments and messages. Check-in texts and the missed check-in alert are part of the paid plan; the 14-day trial includes them.')
help.push('')
for (const sec of SETUP_FAQ) {
  help.push(`### ${sec.title}`)
  for (const it of sec.items) help.push(`- ${it.q} ${it.a}`)
  help.push('')
}
const APP_HELP = help.join('\n')

// ---- assemble -------------------------------------------------------------
const prompt = read('supabase/prompts/maggie-system-prompt-v2.md').trim()
const template = read('supabase/functions/ai-chat/index.template.ts')

const asTemplateLiteral = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
const nonAscii = (s) => (s.match(/[^\x00-\x7F]/g) || []).length

let out = template
  .replace('__SYSTEM_PROMPT__', asTemplateLiteral(prompt))
  .replace('__FRAMEWORK__', asTemplateLiteral(FRAMEWORK))
  .replace('__APP_HELP__', asTemplateLiteral(APP_HELP))
  .replace('__KB_SECTIONS__', JSON.stringify(KB_SECTIONS.map(s => ({ n: s.n, title: s.title, keywords: s.keywords, text: s.text })), null, 0))

// The Supabase editor paste mangles anything outside ASCII, so scrub the few
// typographic characters the knowledge base uses.
out = out
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/—/g, ', ').replace(/–/g, '-').replace(/…/g, '...')
  .replace(/ /g, ' ').replace(/[→]/g, '->').replace(/[✓✔]/g, 'yes')
  .replace(/[•]/g, '-').replace(/×/g, 'x').replace(/é/g, 'e')
const leftover = nonAscii(out)
if (leftover) {
  const chars = [...new Set(out.match(/[^\x00-\x7F]/g))].map(c => `U+${c.codePointAt(0).toString(16)}`)
  console.error(`WARNING: ${leftover} non-ASCII characters left: ${chars.join(' ')}`)
}

writeFileSync(new URL('../supabase/functions/ai-chat/index.ts', import.meta.url), out)
const approxTokens = (s) => Math.round(s.length / 4)
console.log(`ai-chat/index.ts written: ${out.length} chars`)
console.log(`cached prefix ~${approxTokens(prompt + FRAMEWORK + APP_HELP)} tokens (prompt ~${approxTokens(prompt)}, framework ~${approxTokens(FRAMEWORK)}, app help ~${approxTokens(APP_HELP)})`)
console.log(`retrievable sections: ${KB_SECTIONS.map(s => `${s.n}(~${approxTokens(s.text)})`).join(' ')}`)
