# SeniorSafe — Claude Code Project Brief
Last updated: March 2026

---

## March 3, 2026 — Beta Launch Preparation Complete

### Session Summary
Massive security audit + feature buildout session. 50+ fixes deployed across security, family features, AI limits, and freemium enforcement. App is beta-ready for 3–5 families this week.

### What's LIVE Right Now (Deployed & Working)
- **All family features working:** Messages, photos, medications, appointments, emergency info — all visible across family members
- **AI limits changed:** 20 messages per family per month (was 50/user/week). Shared counter on admin's profile, monthly reset.
- **AI moved server-side:** Anthropic API key no longer in browser. All AI calls route through `ai-chat` Supabase Edge Function with SSE streaming.
- **SPA routing fixed:** `vercel.json` rewrites prevent 404 on page refresh.
- **Member signup bug fixed:** Members entering invite code in admin form now skip onboarding correctly.
- **Free tier lock screens built:** AI, Family Hub, Vault, Medications, Appointments, Family Invite all show premium lock screens for free users. Emergency Info is UNLOCKED for free tier. "I Need Help" button hidden for free tier. BottomNav shows lock icons on Vault, Family, AI.

### Security Fixes Deployed (11 Migrations)
1. `lock_down_user_profile_update_policy` — prevent users from changing their own role/tier
2. `fix_anonymous_profile_data_leak` — block anonymous access to profiles
3. `fix_rls_infinite_recursion` — fix circular RLS policy references
4. `family_scoped_rls_for_checkins_messages_photos` — family members see each other's data
5. `add_storage_limits_to_documents_bucket` — 10MB file limit, restricted MIME types
6. `add_timezone_to_user_profile` — timezone column for future use
7. `add_indexes_on_user_id_foreign_keys` — performance indexes on all FK columns
8. `optimize_rls_auth_uid_subselect` — faster RLS using `auth.uid()` directly
9. `family_scope_appointments_medications_medlogs` — family visibility for meds/appts/med_logs
10. `family_scoped_storage_select_for_photos` — storage bucket policy for family photo access
11. `fix_storage_policy_security_definer_family_check` — `is_family_member_file()` SECURITY DEFINER function to fix one-way photo visibility
12. `allow_admin_read_invited_members` — admin can SELECT member rows where `invited_by = auth.uid()` (fixed SMS not reaching family members)

### Client Code Fixes Deployed
- **AppointmentsPage:** Removed `.eq('user_id')` filter, RLS handles family scoping, owner-only delete
- **MedicationsPage:** Removed `.eq('user_id')` filter for meds + med_logs, family_name on med_log inserts, owner-only delete, dose toggle disabled for non-owners
- **FamilyPage:** Storage paths use UUID-first format, signed URLs for private bucket, batch `createSignedUrls()`, full free-tier lock screen
- **AIPage:** Server-side AI via edge function, 20/family/month limit, family counter display, free-tier lock screen
- **DashboardPage:** "I Need Help" hidden for free tier; debug logging added to handleCheckIn() and sendHelpAlert() for SMS pipeline troubleshooting
- **EmergencyPage:** Free tier lock REMOVED (now available to all users)
- **BottomNav:** Family tab marked as premium
- **SignUpPage:** Member via admin form now creates profile + skips onboarding
- **vercel.json:** SPA catch-all rewrite for client-side routing

### Edge Functions Deployed
- **`ai-chat`** — NEW. Handles all AI requests server-side. SSE streaming, family-level monthly limits (20/month), monthly reset, personalized system prompt with family context.
- **`send-sms`** — Twilio REST API for outbound SMS (unchanged this session)
- **`medication-reminders`** — Cron every 5 min for med reminder SMS (unchanged this session)

### What's NOT Deployed Yet / Known Issues
1. **Free tier locks not active** — All beta users default to `subscription_tier = 'paid'`. Lock screens are built but won't trigger until Stripe integration changes tier to 'free'.
2. **Custom 404 page** — Vercel shows default 404 instead of custom page (cosmetic issue).
3. **SMS not sending reliably** — Twilio A2P registration still pending carrier approval. Messages fire but may be held/filtered.
4. **SMS daily check-in limit** — No cap on how many check-in SMS per day. Add with Stripe in Week 3–4.
5. **Stripe not integrated** — No payment flow. Upgrade = "Text Ryan at (336) 553-8933".
6. **Blueprint access code system** — 3 months free for Blueprint buyers not built yet.

### Current Economics
- **Anthropic API:** ~$2.46/month per active family (claude-opus-4-5 at 20 msgs/family/month)
- **App price:** $14.99/month Premium
- **Profit margin:** ~$12.53/family/month (before Twilio SMS costs)
- **Action needed:** Add $100 Anthropic API credits ASAP (current balance low)

### Remaining Tasks Before Beta Launch
| Priority | Task | When |
|---|---|---|
| 🔴 | Add $100 Anthropic API credits | Tomorrow (March 4) |
| 🔴 | Check Twilio balance + top up if needed | Tomorrow (March 4) |
| 🟡 | Fix A2P SMS registration (carrier approval) | Ongoing — Twilio support |
| 🟡 | Test full app flow with 1 family member invite | Before inviting beta families |
| 🟢 | Deploy free tier locks with Stripe | Week 3–4 |
| 🟢 | Add SMS daily check-in cap | Week 3–4 with Stripe |
| 🟢 | Build custom 404 page | Polish phase |
| 🟢 | Blueprint access code system | Post-launch |

### Beta Launch Plan (This Week)
1. **Stage 1:** Ryan tests full flow with own family (1–2 people)
2. **Stage 2:** Invite 3–5 trusted families with direct links
3. **Stage 3:** Gather feedback, fix issues, iterate
4. All beta users stay on `paid` tier. No payment required during beta.
5. Share invite links: `https://app.seniorsafeapp.com/signup?code=XXXXXX`

### Storage Architecture
- **Bucket:** `Documents` (private, 10MB limit)
- **MIME types:** PDF, JPEG, PNG, GIF, WebP
- **Upload path:** `{user-uuid}/family-photos/filename.ext` (UUID-first for RLS)
- **URLs:** Signed URLs only (1-hour expiry), no public URLs
- **RLS:** Own files + family members' `family-photos/` subfolder via `is_family_member_file()` SECURITY DEFINER function

### Key Technical Patterns
- **Family scoping:** RLS uses `family_name = get_my_family_name()` where `get_my_family_name()` is SECURITY DEFINER
- **Admin as source of truth:** AI message count stored on admin's `user_profile.message_count`
- **Member → admin link:** `user_profile.invited_by` points to admin's `user_id`
- **Monthly reset:** Repurposes `message_week_start` column (checks month/year, not days)
- **Edge function auth:** User-auth client (respects RLS) + service-role client (supabaseAdmin, bypasses RLS for writes)

### Deploy Commands Reference
```bash
# Standard deploy (Vercel auto-deploys on push)
git add <files> && git commit -m "description" && git push

# Edge function deploy
SUPABASE_ACCESS_TOKEN=sbp_a58ffe4beec33b3b974ef7ec617439a09adcc9a6 \
  /c/Users/Ryanr/bin/supabase.exe functions deploy <function-name> \
  --project-ref ynsakoxsmuvwfjgbhxky --no-verify-jwt
```

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

## Revenue Streams (Updated March 2026)

### Tier 1: Digital Products (80% of focus)
1. **FREE** — Simple Blueprint (primary lead magnet, email capture via GHL at rigginsstrategicsolutions.com/simpleblueprint)
2. **$47** — Senior Transition Blueprint Core (19 modules, 90+ tools) at seniortransitionblueprint.com
3. **$297** — Senior Transition Blueprint Premium (Core + personalized plan + 60-min coaching call + 90 days email support)
4. **$15/month** — SeniorSafe App subscription (currently free beta)
5. **~$15** — Books on Amazon KDP (2 published — see Books section)

### Tier 2: Real Estate (15% — bonus income, not primary focus)
* **$1,875–5,000** — National Referral Fees
* **$7,500–10,500** — Occasional Local Listings (Greensboro/Triad)

### Tier 3: Speaking (5% — growth channel)
* Consulting is being **phased out** — replaced by Premium Blueprint ($297)
* Speaking engagements ($5K-10K/event at scale)

* Blueprint buyers get 3 months free SeniorSafe access (access code system not yet built)

---

## Books

### Book #1 (Published)
* **Title:** "The Unheard Conversation: How to Talk to Your Aging Parents About What's Next—Without Starting a War"
* Published on Amazon KDP
* Covers the emotional side of senior transitions

### Book #2 (Published)
* **Title:** "The Other Side of the Conversation: The Complete Family Playbook for Senior Transitions"
* Published on Amazon KDP
* Covers the practical/tactical side — home sale strategies, predatory investor playbook, renovation traps, financial planning

Both books drive readers to rigginsstrategicsolutions.com/bookresources for email capture.

---

## Ryan's Working Style
- Has ADHD — keep things simple, actionable, direct
- Prefers copy-paste ready outputs over complex technical explanations
- Guiding question: "Does this help sell more Blueprints, grow the email list, or increase YouTube audience?"
- The app stays SIMPLE — no new features for 12+ months. Fix bugs, connect Stripe, that's it.
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
SUPABASE_ACCESS_TOKEN=sbp_9c4d988f47762fa77d32eb3c9d0929318633a46c \
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
12. **Supabase → GHL webhook** — when a new user signs up in SeniorSafe, their email needs to auto-sync to GHL and trigger a workflow (tag: "SeniorSafe-Free" or "SeniorSafe-Paid")
13. **SeniorSafe GHL workflows** — need Free User onboarding sequence and Paid User onboarding + testimonial request sequence

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
- **Squarespace:** main website + domain registrar (rigginsstrategicsolutions.com)
- **Buffer:** social media scheduling (Saturday morning content workflow)
- **Make.com:** automation scenarios
- **Descript:** video editing
- **NotebookLM:** content generation with RSS instruction documents
- **Matchmaker.fm + PodMatch:** podcast booking profiles
- **Stripe:** payment processing (integrated with GHL, not yet in app)
- **GitHub RSS-Agent-Brain repo:** business context files for Make.com automations

## Key URLs

* Main site: rigginsstrategicsolutions.com
* Simple Blueprint (lead magnet): rigginsstrategicsolutions.com/simpleblueprint
* Book Resources (email capture): rigginsstrategicsolutions.com/bookresources
* Blueprint purchase: rigginsstrategicsolutions.com/the-blueprint
* Starter Guide: rigginsstrategicsolutions.com/starterguide
* Booking: https://api.leadconnectorhq.com/widget/booking/PEGCu2kXYDZgAPPzXGv5
* App (production): app.seniorsafeapp.com
* App (beta): senior-safe-hazel.vercel.app
* GHL landing pages: go.rigginsstrategicsolutions.com

## Contact
- **Cell:** (336) 553-8933
- **Email:** ryan@rigginsstrategicsolutions.com
- **NC Realtor License:** #361546, eXp Realty
