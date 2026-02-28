# SeniorSafe — Claude Code Project Brief
Last updated: February 28, 2026

---

## What This Project Is
SeniorSafe is a family coordination app for seniors and their adult children, built by Ryan Riggins of Riggins Strategic Solutions. It helps families navigate senior housing transitions with daily check-ins, AI guidance, document storage, medication tracking, and family coordination tools.

---

## Business Context
- **Owner:** Ryan Riggins, licensed NC Realtor #361546, eXp Realty
- **Business:** Riggins Strategic Solutions (rigginsstrategicsolutions.com)
- **Positioning:** "Switched sides" — former real estate investor/house flipper turned consumer protection advisor
- **Target audience:** Adult children ages 40–65 helping aging parents navigate senior transitions
- **Core mission:** Protect families from predatory real estate practices and guide them through senior transitions

---

## Revenue Streams
1. **$47** — Senior Transition Blueprint (19 modules, 90+ tools) at seniortransitionblueprint.com
2. **$12–25/month** — SeniorSafe App subscription (beta is free)
3. **$1,500–2,500** — Strategy Consultations
4. **$1,875–5,000** — National Referral Fees
5. **$7,500–10,500** — Local Real Estate Listings
- Blueprint buyers get 3 months free SeniorSafe access (access code system not yet built)

---

## Book
- **Title:** "The Unheard Conversation: How to Talk to Your Aging Parents About What's Next—Without Starting a War"
- **Author:** Ryan Riggins
- Formatted for Amazon KDP 6x9 paperback
- Will be published on KDP and Gumroad as a tripwire product
- Referenced in email nurture sequences as "coming soon"

---

## Ryan's Working Style
- Has ADHD — keep things simple, actionable, direct
- Prefers copy-paste ready outputs over complex technical explanations
- Guiding question: "Does this move me toward 2-3 advisory calls per day?"
- Manual simple processes over complex automations
- Saturday morning content workflow: paste YouTube scripts → generate 30 posts → schedule in Buffer

---

## SeniorSafe App
- **Live URL:** https://senior-safe-hazel.vercel.app
- **GitHub:** https://github.com/rriggins811/SeniorSafe (PUBLIC repo)
- **Local dev path:** C:\Users\Ryanr\seniorsafe
- **Hosting:** Vercel (auto-deploys on `git push` to `main`)
- **Beta:** All beta users default to 'paid' tier. Free tier built in code but not exposed yet.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React + Vite | React 19.2, Vite 7.3 |
| Styling | Tailwind CSS v4 | 4.2.1 (via `@tailwindcss/vite`) |
| Routing | React Router DOM | 7.13 |
| Icons | Lucide React | 0.575 |
| Database/Auth | Supabase | JS client 2.98 |
| AI | Anthropic Claude API | claude-opus-4-5 (direct browser) |
| SMS | Twilio REST API | via Supabase Edge Functions |
| Hosting | Vercel | auto-deploy from GitHub |

### Tailwind CSS v4 — CRITICAL
Do NOT use `tailwind.config.js`. Config lives in `src/index.css`:
```css
@import "tailwindcss";

@theme {
  --color-navy: #1B365D;
  --color-gold: #D4A843;
  --color-lightgray: #F5F5F5;
}
```
`vite.config.js`:
```js
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({ plugins: [react(), tailwindcss()] })
```
Brand colors used inline: `bg-[#1B365D]`, `text-[#D4A843]` — not via config class names.

### Brand Colors
- **Navy:** `#1B365D`
- **Gold:** `#D4A843`
- **Background:** `#F5F5F5`
- **White:** `#FFFFFF`

---

## Supabase Details
- **Project ref:** `ynsakoxsmuvwfjgbhxky`
- **URL:** `https://ynsakoxsmuvwfjgbhxky.supabase.co`
- **Auth:** email/password via `supabase.auth.signUp` / `signInWithPassword`
- **Client file:** `src/lib/supabase.js` — uses `VITE_SUPABASE_PUBLISHABLE_KEY` (NOT `VITE_SUPABASE_ANON_KEY`)
- **Storage bucket:** `Documents` (capital D — lowercase causes 400 errors)
  - Always: `supabase.storage.from('Documents')`
  - URL path marker for deletes: `/object/public/Documents/`

---

## Database Tables

### `user_profile` (key table)
```
user_id             uuid PK (FK auth.users)
first_name          text
last_name           text
family_name         text
senior_name         text
senior_age          int
living_situation    text
timeline            text
biggest_concern     text
phone               text
role                text  -- 'admin' or 'member'
family_code         text  -- 6-char uppercase, admin only
invited_by          uuid  -- admin's user_id (members only)
onboarding_complete boolean
sms_notifications   boolean DEFAULT true
message_count       int DEFAULT 0
message_limit       int DEFAULT 50
subscription_tier   text DEFAULT 'paid'  -- 'free' or 'paid'
message_week_start  date  -- for weekly AI reset (paid tier)
```

### All tables
| Table | Purpose |
|---|---|
| `user_profile` | Core user data, roles, family linking, onboarding answers |
| `checkins` | Daily "I'm Okay" records (user_id, checked_in_at) |
| `medications` | Medication list (med_name, dosage, frequency, times[], reminder_enabled, reminder_phone) |
| `med_logs` | Daily dose log (medication_id, scheduled_time, date, taken_at) |
| `appointments` | Appointments (title, provider_name, appointment_type, appointment_date, appointment_time, location, notes) |
| `family_messages` | Message board (author_name, message_text, photo_url) |
| `family_photos` | Photo grid (uploaded_by, photo_url) |
| `documents` | Vault metadata (file_name, file_url, category, label) |
| `emergency_info` | First responder card (blood_type, allergies, doctors, emergency contacts, insurance) |
| `family_members` | Legacy/reserved |
| `reminder_logs` | Dedup tracker for medication SMS (medication_id, date, scheduled_time) |

### Pending SQL (run in Supabase SQL Editor if not applied)
```sql
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS sms_notifications boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS message_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_limit int DEFAULT 50,
  ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS message_week_start date;
```

---

## Edge Functions

### `send-sms` — Outbound SMS via Twilio
File: `supabase/functions/send-sms/index.ts`
Called from: `src/lib/sms.js`

**Twilio REST API** (Basic auth with SID:Token base64, form-encoded body):
- Endpoint: `POST https://api.twilio.com/2010-04-01/Accounts/{ACCOUNT_SID}/Messages.json`
- Auth: `Authorization: Basic base64(SID:TOKEN)`
- Body: form-encoded `To`, `From`, `Body`
- Phone normalization: strips non-digits, prepends `+1` if needed

Secrets needed in Supabase:
```
TWILIO_ACCOUNT_SID   <in Supabase dashboard>
TWILIO_AUTH_TOKEN    <auth token>
TWILIO_PHONE_NUMBER  +13365536225
```

### `medication-reminders` — Cron SMS
File: `supabase/functions/medication-reminders/index.ts`
**Cron:** every 5 minutes — set in Supabase Dashboard → Edge Functions → Schedule → `*/5 * * * *`

Flow: query medications with `reminder_enabled=true` → check ±5 min window → skip if taken → skip if reminder_logs exists → send SMS → log to `reminder_logs`

⚠️ **KNOWN ISSUE:** This function still uses the old GHL endpoint — needs updating to use Twilio (same pattern as send-sms).

### Deploy command
```bash
SUPABASE_ACCESS_TOKEN=sbp_9c4d988f47762fa77d32eb3c9d0929318633a46c \
  /c/Users/Ryanr/bin/supabase.exe functions deploy <function-name> \
  --project-ref ynsakoxsmuvwfjgbhxky --no-verify-jwt
```
- CLI binary: `/c/Users/Ryanr/bin/supabase.exe` (v2.75.0, downloaded manually to avoid npm install issue)
- Use `SUPABASE_ACCESS_TOKEN` env var — `--token` flag not supported in this CLI version

---

## Twilio SMS
- **Account SID:** <in Supabase dashboard>
- **From number:** +13365536225

### SMS helper — `src/lib/sms.js`
```js
const EDGE_FN_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/send-sms'
export async function sendSMS(to, message) { ... }
```

---

## Supabase Secrets (server-side, edge functions only)
```
TWILIO_ACCOUNT_SID   <in Supabase dashboard>
TWILIO_AUTH_TOKEN    <in Supabase dashboard>
TWILIO_PHONE_NUMBER  +13365536225
```

## Vercel Environment Variables (client-side)
```
VITE_SUPABASE_URL              https://ynsakoxsmuvwfjgbhxky.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY  <anon/publishable key>
VITE_ANTHROPIC_API_KEY         <anthropic key — browser-exposed, move to edge fn post-beta>
```

---

## File Structure
```
seniorsafe/
├── CLAUDE.md                          ← this file
├── src/
│   ├── main.jsx                       # React entry point
│   ├── App.jsx                        # BrowserRouter + all routes + ProtectedRoute
│   ├── index.css                      # Tailwind v4 @import + @theme colors
│   ├── lib/
│   │   ├── supabase.js                # Supabase client
│   │   └── sms.js                     # sendSMS() → calls send-sms edge function
│   ├── components/
│   │   └── BottomNav.jsx              # Bottom nav: Home / Vault / Family / AI
│   └── pages/
│       ├── WelcomePage.jsx            # /
│       ├── SignUpPage.jsx             # /signup (admin + ?code= member flow)
│       ├── SignInPage.jsx             # /signin
│       ├── OnboardingPage.jsx         # /onboarding — 6 questions, admin only
│       ├── DashboardPage.jsx          # /dashboard
│       ├── VaultPage.jsx              # /vault
│       ├── MedicationsPage.jsx        # /medications
│       ├── AppointmentsPage.jsx       # /appointments
│       ├── FamilyPage.jsx             # /family
│       ├── FamilyInvitePage.jsx       # /family-invite
│       ├── AIPage.jsx                 # /ai
│       ├── EmergencyPage.jsx          # /emergency
│       ├── ProfilePage.jsx            # /profile
│       ├── ContactPage.jsx            # /contact
│       ├── TermsPage.jsx              # /terms (public)
│       └── PrivacyPage.jsx            # /privacy (public)
├── supabase/
│   └── functions/
│       ├── send-sms/index.ts
│       └── medication-reminders/index.ts
├── vite.config.js
├── package.json
└── .env                               # local only, not committed
```

---

## All Routes (App.jsx)
```jsx
// Public — no auth required
/ → WelcomePage
/signup → SignUpPage
/signin → SignInPage
/terms → TermsPage
/privacy → PrivacyPage

// Protected — ProtectedRoute wrapper
/onboarding → OnboardingPage
/dashboard → DashboardPage
/vault → VaultPage
/ai → AIPage
/contact → ContactPage
/medications → MedicationsPage
/appointments → AppointmentsPage
/family → FamilyPage
/emergency → EmergencyPage
/family-invite → FamilyInvitePage
/profile → ProfilePage
```

### ProtectedRoute pattern
`useState(undefined)` — `undefined`=loading (returns null), `null`=redirect to /signin, object=render children.

---

## Page Details

### SignUpPage — two flows
1. **Admin flow** (no `?code=` in URL): full form with family name + optional invite code field → onboarding
2. **Member flow** (`?code=XXXXXX` in URL): `MemberSignup` component — simplified form (first/last name, email, phone, password, pre-filled invite code) → validates code → creates `user_profile` directly with `role='member'`, `onboarding_complete=true` → goes straight to `/dashboard`

### OnboardingPage — admin only, 6 steps
1. Loved one's first name
2. Their age
3. Living situation (select)
4. Timeline (select)
5. Biggest concern (select)
6. Your mobile number (optional, for SMS notifications)

Final upsert generates `family_code` inline if not in metadata (safety net). Sets `onboarding_complete: true`.

### DashboardPage — role-based
- **Admin view:** "I'm Okay Today" button → inserts checkin → daily limit (once per day, `alreadyCheckedIn` state) → paid tier sends SMS to family + confirmation to senior; free tier records in app only
- **Member view:** shows admin's check-in status; yellow warning banner if no check-in by 10am; "Send them a reminder" button → SMS to admin's phone
- Header icons (admin): Family Invite, Profile, Emergency, Contact Ryan, Sign Out
- Bottom nav: Home / Vault / Family / AI

### AIPage — key details
- Direct Anthropic API from browser (`anthropic-dangerous-direct-browser-access: true`)
- Model: `claude-opus-4-5` | Key: `VITE_ANTHROPIC_API_KEY`
- SYSTEM_PROMPT: personalized with user_profile data (senior_name, age, living_situation, timeline, biggest_concern), includes all 19 Blueprint module references
- **Free tier:** 10 messages lifetime (no reset)
- **Paid tier:** 50 messages/week (resets every 7 days via `message_week_start` column)
- Uses refs (`msgCountRef`, `msgLimitRef`, `userIdRef`, `profileRef`, `soundOnRef`, `tierRef`) to avoid stale closures
- At limit: shows lead capture message with Ryan's text number (336) 553-8933
- Counter below input: gray → yellow at 80%+ → red at 95%+ of limit
- Voice: Web Speech API (`speechSynthesis`) with sound toggle
- **iOS fix:** "Tap to enable voice" banner on mobile to unlock audio context (required by iOS Safari)

### FamilyInvitePage
- Admin: shows family_code in large display, copy + share buttons, member list with remove option
- If `family_code` is null (legacy account): auto-generates 6-char code and saves to `user_profile`
- Member: read-only message — "Only the account admin can generate invite codes"

### VaultPage
- Upload: file picker → `supabase.storage.from('Documents').upload()` → save URL to `documents` table
- Categories: Legal, Medical, Financial, Personal
- Delete: extract path from URL using `/object/public/Documents/` marker → `storage.remove()` + `documents.delete()`

### AppointmentsPage
- Types: Medical, Dental, Vision, Therapy, Other (color-coded chips)
- `downloadIcs(appt)` — generates `.ics` and triggers browser download
- Shows upcoming (≥ today) and past sections

### EmergencyPage
- Blood types: Unknown, A+, A-, B+, B-, AB+, AB-, O+, O-
- View/edit toggle — edit mode saves to `emergency_info` table

### MedicationsPage
- Frequencies: Once daily, Twice daily, Three times daily, As needed
- Dose status per time slot: taken (green), overdue (red), upcoming (gray)
- SMS reminder toggle: saves `reminder_enabled` + `reminder_phone` to medications row
- Pre-fills `reminder_phone` from `user_profile.phone`

### BottomNav (`src/components/BottomNav.jsx`)
- Tabs: Home (`/dashboard`), Vault (`/vault`), Family (`/family`), AI (`/ai`)
- Prop: `inline={true}` for flex column layouts; default is `position: fixed` bottom

---

## Family Invite System
- Admin generates unique 6-char uppercase `family_code` (stored in `user_profile`)
- Share link: `https://senior-safe-hazel.vercel.app/signup?code=XXXXXX`
- Member lands on simplified join form → profile created with `role='member'`, `invited_by=admin.user_id`
- family_code generation: SignUpPage → stored in user_metadata → OnboardingPage reads metadata OR generates inline → FamilyInvitePage auto-generates if still null (3 layers of safety)

---

## SMS Notifications
- **Provider:** Twilio (replaced GHL)
- **From number:** (336) 553-6225 / `+13365536225`
- **I'm Okay (paid tier):** notifies all family members with phone + confirmation to senior's own phone
- **I'm Okay (free tier):** records check-in in app only, no SMS sent
- **Medication reminders:** sends to `reminder_phone` on each medication record at scheduled time
- **Missed check-in:** member sees yellow banner + "Send reminder" button → SMS to admin
- **A2P registration:** may be pending — texts fire correctly, carrier may hold until approved

---

## Freemium Model
- **subscription_tier** column on `user_profile` ('free' or 'paid', DEFAULT 'paid')
- All beta users default to 'paid' — free tier built in code but not exposed yet
- **Paid features:** I'm Okay with SMS, all pages, 50 AI messages/week (resets every 7 days)
- **Free features:** I'm Okay (no SMS), messages view-only, photos/vault/meds/appts/emergency/invite blocked
- **Free AI limit:** 10 messages lifetime (no reset)
- **Weekly reset:** `message_week_start` date on profile; if >7 days old → reset count to 0
- **Stripe:** not yet integrated — upgrade by texting Ryan (336) 553-8933

## Known Issues / Pending Work
1. **medication-reminders edge fn** uses old GHL endpoint — needs updating to Twilio
2. **A2P SMS registration** may be pending — carrier-dependent
3. **Stripe** not integrated — upgrade manually via text to Ryan
4. **Blueprint access codes** system not built
5. **Anthropic key** is browser-exposed (`VITE_` prefix) — move to edge function post-beta
6. **Pending SQL** if not yet applied in Supabase:
   ```sql
   ALTER TABLE user_profile
     ADD COLUMN IF NOT EXISTS sms_notifications boolean DEFAULT true,
     ADD COLUMN IF NOT EXISTS message_count int DEFAULT 0,
     ADD COLUMN IF NOT EXISTS message_limit int DEFAULT 50,
     ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'paid',
     ADD COLUMN IF NOT EXISTS message_week_start date;
   ```
7. **Cron schedule** for medication-reminders: set `*/5 * * * *` in Supabase Dashboard → Edge Functions → medication-reminders → Schedule

---

## Git / Deploy Workflow
```bash
# Standard deploy (Vercel auto-deploys on push)
git add <files>
git commit -m "description"
git push

# Edge function deploy
SUPABASE_ACCESS_TOKEN=sbp_9c4d988f47762fa77d32eb3c9d0929318633a46c \
  /c/Users/Ryanr/bin/supabase.exe functions deploy <function-name> \
  --project-ref ynsakoxsmuvwfjgbhxky --no-verify-jwt

# Trigger deploy without code change
git commit --allow-empty -m "trigger deploy" && git push
```

Git config for this repo:
- `user.email`: ryan@rigginsstrategicsolutions.com
- `user.name`: Ryan Riggins

---

## Other Business Tools
- **GoHighLevel:** CRM, email automation, booking, landing pages (go.rigginsstrategicsolutions.com)
- **Squarespace:** main website (rigginsstrategicsolutions.com)
- **Buffer:** social media scheduling (Saturday morning content workflow)
- **Make.com:** automation scenarios
- **Descript:** video editing
- **NotebookLM:** content generation with RSS instruction documents
- **Matchmaker.fm + PodMatch:** podcast booking profiles
- **Stripe:** payment processing (integrated with GHL, not yet in app)
- **GitHub RSS-Agent-Brain repo:** business context files for Make.com automations

## Key URLs
- Main site: rigginsstrategicsolutions.com
- Blueprint: seniortransitionblueprint.com
- Starter Guide: rigginsstrategicsolutions.com/starterguide
- Booking: https://api.leadconnectorhq.com/widget/booking/PEGCu2kXYDZgAPPzXGv5
- App: senior-safe-hazel.vercel.app
- GHL landing pages: go.rigginsstrategicsolutions.com

## Contact
- **Cell:** (336) 553-8933
- **Email:** ryan@rigginsstrategicsolutions.com
- **NC Realtor License:** #361546, eXp Realty
