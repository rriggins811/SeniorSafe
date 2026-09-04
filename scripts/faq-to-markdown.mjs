// Emits the Help Center setup FAQ as a markdown section for Maggie's knowledge base.
// Usage: node scripts/faq-to-markdown.mjs > /tmp/faq.md
import { SETUP_FAQ } from '../src/content/setupFaq.js'

const out = []
out.push('## 19. Using the SeniorSafe App: setup and troubleshooting')
out.push('')
out.push('These are the answers the app itself gives in its Help Center. When someone asks how to set up SeniorSafe, invite family, or fix a check-in or text problem, answer from here in plain words. If the fix is not here, tell them to text Ryan at (336) 553-8933 with what they see on the screen.')
out.push('')
out.push('How the app is organized: one person sets up the family and manages the subscription (the "owner", usually an adult child). One person is "the one who checks in" (the senior), who has a big "I\'m Okay Today" button and a red "I Need Help" button. Everyone else joins as a family member and sees the senior\'s check-in status, medications, appointments, and messages. Check-in texts and the missed check-in alert are Premium features; the 14-day trial includes them.')
out.push('')
for (const sec of SETUP_FAQ) {
  out.push(`### ${sec.title}`)
  out.push('')
  for (const it of sec.items) {
    out.push(`**Q: ${it.q}**`)
    out.push(`A: ${it.a}`)
    out.push('')
  }
}
process.stdout.write(out.join('\n'))
