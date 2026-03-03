# SeniorSafe — Claude Code Project Brief
Last updated: March 2, 2026

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
2. **$14.99/month** — SeniorSafe App Premium subscription (free tier available)
3. **$1,500–2,500** — Strategy Consultations
4. **$1,875–5,000** — National Referral Fees
5. **$7,500–10,500** — Local Real Estate Listings
- Blueprint buyers get 3 months free SeniorSafe Premium access (access code system not yet built)

---

## Book
- **Title:** "The Unheard Conversation: How to Talk to Your Aging Parents About What's Next—Without Starting a War"
- **Author:** Ryan Riggins
- **Status:** Published on Amazon KDP (ebook + 6x9 paperback)
- Gumroad version formatted but not published yet
- Referenced in email nurture sequences

---

## Ryan's Working Style
- Has ADHD — keep things simple, actionable, direct
- Prefers copy-paste ready outputs over complex technical explanations
- Guiding question: "Does this move me toward 2-3 advisory calls per day?"
- Manual simple processes over complex automations
- Saturday morning content workflow: paste YouTube scripts → generate 30 posts → schedule in Buffer

---

## SeniorSafe App — Current Deployment

### Live URLs
- **App:** https://app.seniorsafeapp.com (custom domain, configured March 2, 2026)
- **Landing Page:** https://seniorsafeapp.com (GHL marketing page, configured March 2, 2026)
- **Legacy URL:** https://senior-safe-hazel.vercel.app (still works, redirects to custom domain)

### Domain Setup (March 2, 2026)
- **Root domain:** seniorsafeapp.com → GoHighLevel landing page
  - DNS: A record + CNAME pointing to GHL servers
  - Managed in Squarespace domain registrar
- **Subdomain:** app.seniorsafeapp.com → Vercel React app
  - DNS: CNAME pointing to Vercel (`cname.vercel-dns.com`)
  - SSL auto-provisioned by Vercel

### Repository & Hosting
- **GitHub:** https://github.com/rriggins811/SeniorSafe (PUBLIC repo)
- **Local dev path:** C:\Users\Ryanr\seniorsafe
- **Hosting:** Vercel (auto-deploys on `git push` to `main`)
- **Beta status:** All beta users default to 'paid' tier. Free tier fully built but not exposed to public yet.

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
| Landing Page | GoHighLevel | seniorsafeapp.com |

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
| `user_profile` | Core user data, roles, family linking, onboarding answers, freemium tier |
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
**Status:** ✅ Updated to Twilio (March 1, 2026)
**Cron:** every 5 minutes — set in Supabase Dashboard → Edge Functions → Schedule → `*/5 * * * *`

Flow: query medications with `reminder_enabled=true` → check ±5 min window → skip if taken → skip if reminder_logs exists → send SMS via Twilio → log to `reminder_logs`

Uses same Twilio pattern as `send-sms`:
- REST API with Basic Auth
- Form-encoded body
- Phone normalization (+1 prefix)

### Deploy command
```bash
SUPABASE_ACCESS_TOKEN=REDACTED \
  /c/Users/Ryanr/bin/supabase.exe functions deploy <function-name> \
  --project-ref ynsakoxsmuvwfjgbhxky --no-verify-jwt
```
- CLI binary: `/c/Users/Ryanr/bin/supabase.exe` (v2.75.0, downloaded manually to avoid npm install issue)
- Use `SUPABASE_ACCESS_TOKEN` env var — `--token` flag not supported in this CLI version

---

## Twilio SMS
- **Account SID:** <in Supabase dashboard>
- **From number:** (336) 553-6225 / `+13365536225`
- **A2P Registration:** Pending carrier approval (messages fire correctly, may be held until approved)

### SMS helper — `src/lib/sms.js`
```js
const EDGE_FN_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/send-sms'
export async function sendSMS(to, message) { ... }
```

### SMS Usage in App
- **I'm Okay (paid tier):** notifies all family members with phone + confirmation to senior's own phone
- **I'm Okay (free tier):** records check-in in app only, no SMS sent
- **I Need Help button:** sends urgent alert to all family members (paid tier only)
- **Medication reminders:** sends to `reminder_phone` on each medication record at scheduled time
- **Missed check-in:** member sees yellow banner + "Send reminder" button → SMS to admin

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

**Admin view:**
- **"I'm Okay Today" button** → inserts checkin → daily limit (once per day, `alreadyCheckedIn` state)
  - Paid tier: sends SMS to family + confirmation to senior
  - Free tier: records in app only, no SMS
- **"I Need Help" button** (NEW - March 2, 2026) → emergency alert
  - Stacked below "I'm Okay" button
  - Red styling (bg-red-600), smaller padding (py-3)
  - Confirmation modal prevents accidental clicks: "⚠️ Are you sure? This will send an urgent alert to your entire family."
  - Two-button modal: "Yes, Send Alert" (red) | "Cancel" (gray)
  - On confirm: SMS blast to all family members with phones
  - Message: "🆘 URGENT: [Senior Name] pressed 'I Need Help' at [time]. Please check on them immediately. - SeniorSafe Alert"
  - Success message: "Help alert sent to your family!" (auto-closes after 3 seconds)
  - Uses existing sendSMS() from src/lib/sms.js, queries user_profile for family_code matches
- Header icons: Family Invite, Profile, Emergency, Contact Ryan, Sign Out
- Bottom nav: Home / Vault / Family / AI

**Member view:**
- Shows admin's check-in status
- Yellow warning banner if no check-in by 10am
- "Send them a reminder" button → SMS to admin's phone

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
- Share link: `https://app.seniorsafeapp.com/signup?code=XXXXXX`
- Member lands on simplified join form → profile created with `role='member'`, `invited_by=admin.user_id`
- family_code generation: SignUpPage → stored in user_metadata → OnboardingPage reads metadata OR generates inline → FamilyInvitePage auto-generates if still null (3 layers of safety)

---

## Freemium Model
- **subscription_tier** column on `user_profile` ('free' or 'paid', DEFAULT 'paid')
- All beta users default to 'paid' — free tier built in code but not exposed to public yet
- **Paid features ($14.99/month):** I'm Okay with SMS, "I Need Help" alerts, all pages, 50 AI messages/week (resets every 7 days)
- **Free features:** I'm Okay (no SMS), messages view-only, photos/vault/meds/appts/emergency/invite blocked, "I Need Help" blocked
- **Free AI limit:** 10 messages lifetime (no reset)
- **Weekly reset:** `message_week_start` date on profile; if >7 days old → reset count to 0
- **Stripe:** not yet integrated — upgrade by texting Ryan (336) 553-8933

---

## Landing Page (GoHighLevel)

**URL:** https://seniorsafeapp.com
**Built:** March 2, 2026
**Purpose:** Marketing landing page for SeniorSafe app

### Page Structure
1. **Hero Section**
   - Shield logo with navy/gold branding
   - Headline: "Your family. One place. One plan."
   - Subheadline: "The app built for families navigating senior transitions."
   - CTAs: "Get Started" + "Sign In" → app.seniorsafeapp.com

2. **Features Grid** (8 feature cards)
   - Daily Check-Ins, Medication Tracking, AI Assistant
   - Document Vault, Appointments, Emergency Alerts
   - Family Messages, Emergency Info Card

3. **How It Works** (3-step flow)
   - Sign Up → Invite Family → Stay Connected

4. **Pricing** (Free vs. Premium $14.99/month)
   - Free tier benefits clearly listed
   - Premium tier with "Most Popular" badge
   - All features itemized

5. **Resources Section**
   - Links to Starter Guide, Book, Blueprint
   - "Not Ready to Commit?" positioning

6. **Final CTA + Footer**
   - Repeat signup CTAs
   - Text Ryan option
   - Terms, Privacy, Powered by RSS

### Design
- Navy (#1B365D) and Gold (#D4A843) color scheme
- Mobile-responsive grid layouts
- Clean, professional PBS-documentary tone
- No excessive formatting or bullet points in prose

---

## RSS Website Integration

**New Page:** /seniorsafe-app (created March 2, 2026)
**Status:** Built, unlisted until payment integration complete
**Purpose:** Showcase SeniorSafe on main RSS website

### Page Content
- Standalone product positioning (not dependent on Blueprint)
- All 8 features highlighted
- Pricing displayed ($14.99/month Premium, Free tier)
- Connection to Blueprint explained (optional companion tool)
- Links to app.seniorsafeapp.com

### Header Navigation
When published, add to main nav as: "SeniorSafe App"

---

## Known Issues / Pending Work

### 🔴 CRITICAL (Fix Before Beta Launch)
1. **Document Vault** — needs testing for upload/download/delete functionality
2. **Anthropic API key exposed** — VITE_ prefix makes it browser-accessible; move to Supabase Edge Function
3. **Freemium tier restrictions not enforced in UI** — free users can currently access all pages; need to add subscription_tier checks

### 🟡 IMPORTANT (Complete Before Public Announcement)
4. **Stripe integration** — no payment flow yet; all users default to 'paid' manually
5. **Blueprint access code system** — 3 months free for Blueprint buyers not built
6. **A2P SMS registration** — pending carrier approval (Twilio configured, messages fire but may be held)
7. **Terms & Privacy pages** — routes exist but content not written

### 🟢 POLISH (Can Do After Launch)
8. **Message limit enforcement** — weekly reset logic exists but needs testing
9. **Medication reminders cron verification** — confirm 5-minute schedule fires correctly
10. **Mobile responsiveness testing** — all pages need phone/tablet verification
11. **Family invite flow testing** — confirm invite codes work end-to-end

---

## Git / Deploy Workflow
```bash
# Standard deploy (Vercel auto-deploys on push)
git add <files>
git commit -m "description"
git push

# Edge function deploy
SUPABASE_ACCESS_TOKEN=REDACTED \
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
- **Squarespace:** main website + domain registrar (rigginsstrategicsolutions.com)
- **Buffer:** social media scheduling (Saturday morning content workflow)
- **Make.com:** automation scenarios
- **Descript:** video editing
- **NotebookLM:** content generation with RSS instruction documents
- **Matchmaker.fm + PodMatch:** podcast booking profiles
- **Stripe:** payment processing (integrated with GHL, not yet in app)
- **GitHub RSS-Agent-Brain repo:** business context files for Make.com automations

## Key URLs
- Main site: rigginsstrategicsolutions.com
- App: app.seniorsafeapp.com
- Landing page: seniorsafeapp.com
- Blueprint: seniortransitionblueprint.com
- Starter Guide: rigginsstrategicsolutions.com/starterguide
- Booking: https://api.leadconnectorhq.com/widget/booking/PEGCu2kXYDZgAPPzXGv5
- GHL landing pages: go.rigginsstrategicsolutions.com
- Book: Amazon (search "The Unheard Conversation Ryan Riggins")

## Contact
- **Cell:** (336) 553-8933
- **Email:** ryan@rigginsstrategicsolutions.com
- **NC Realtor License:** #361546, eXp Realty
