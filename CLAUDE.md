# SeniorSafe — Claude Code Project Brief

## What This Is
SeniorSafe is a family coordination app for senior housing transitions. Built by Ryan Riggins of Riggins Strategic Solutions, LLC (Licensed NC Realtor #361546, eXp Realty). Targeted at adult children (40–65) helping aging parents navigate senior transitions.

## Live URLs
- **App:** https://senior-safe-hazel.vercel.app
- **GitHub:** https://github.com/rriggins811/SeniorSafe (public repo)
- **Hosting:** Vercel (auto-deploys from GitHub `main` branch)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19.2 + Vite 7.3 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite` plugin) |
| Database/Auth | Supabase (`@supabase/supabase-js` v2.98) |
| Routing | React Router DOM v7.13 |
| Icons | Lucide React v0.575 |
| AI Chat | Anthropic API (direct browser, `claude-opus-4-5`) |
| SMS | GoHighLevel (GHL) API via Supabase Edge Function |
| Hosting | Vercel |

### Key package versions (package.json)
```json
"react": "^19.2.0"
"react-router-dom": "^7.13.1"
"tailwindcss": "^4.2.1"
"@tailwindcss/vite": "^4.2.1"
"@supabase/supabase-js": "^2.98.0"
"lucide-react": "^0.575.0"
"vite": "^7.3.1"
```

---

## Tailwind CSS v4 — IMPORTANT

Tailwind v4 works differently from v3. Do NOT use `tailwind.config.js`.

**`src/index.css`:**
```css
@import "tailwindcss";

@theme {
  --color-navy: #1B365D;
  --color-gold: #D4A843;
  --color-lightgray: #F5F5F5;
}
```

**`vite.config.js`:**
```js
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({ plugins: [react(), tailwindcss()] })
```

Brand colors used inline (e.g. `bg-[#1B365D]`, `text-[#D4A843]`) not via config classes.

---

## Brand Colors
- Navy: `#1B365D`
- Gold: `#D4A843`
- Background: `#F5F5F5`
- White: `#FFFFFF`

---

## Supabase

- **Project ref:** `ynsakoxsmuvwfjgbhxky`
- **URL:** `https://ynsakoxsmuvwfjgbhxky.supabase.co`
- **Client file:** `src/lib/supabase.js`
  - Uses env var `VITE_SUPABASE_PUBLISHABLE_KEY` (NOT `VITE_SUPABASE_ANON_KEY`)
  - Created with `createClient(supabaseUrl, supabaseKey)`

### Database Tables

| Table | Purpose |
|---|---|
| `user_profile` | Core user data, role, family_code, invited_by, phone, onboarding answers |
| `checkins` | Daily "I'm Okay" check-in records |
| `medications` | Medication list per user (active flag, times, reminder settings) |
| `med_logs` | Daily medication taken/skipped log |
| `appointments` | Upcoming appointments with type, provider, date, time |
| `family_messages` | Family message board posts |
| `family_photos` | Family photo uploads |
| `documents` | Vault document metadata (file_url points to Supabase storage) |
| `emergency_info` | First responder card (blood type, allergies, doctors, insurance) |
| `family_members` | (legacy/reserved) |
| `reminder_logs` | Tracks which medication SMS reminders were already sent (dedup) |

### Key `user_profile` columns
```sql
user_id          uuid (PK, FK to auth.users)
family_name      text
first_name       text
last_name        text
phone            text
role             text  -- 'admin' or 'member'
family_code      text  -- 6-char uppercase, admin only
invited_by       uuid  -- admin's user_id, for members
onboarding_complete boolean
senior_name      text
senior_age       int
living_situation text
timeline         text
biggest_concern  text
sms_notifications boolean DEFAULT true
message_count    int DEFAULT 0
message_limit    int DEFAULT 50
```

### Storage Bucket
- Name: **`Documents`** (capital D — IMPORTANT, lowercase causes 400 errors)
- Used for vault document uploads and family photos
- Always reference as `supabase.storage.from('Documents')`

### Pending SQL (run in Supabase SQL Editor if not yet applied)
```sql
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS sms_notifications boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS message_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_limit int DEFAULT 50;
```

---

## Supabase Edge Functions

### `send-sms` — outbound SMS via GHL API
- **File:** `supabase/functions/send-sms/index.ts`
- **Called from:** `src/lib/sms.js`
- **Flow:** normalize phone → find/create GHL contact by phone → `POST /conversations/messages`
- GHL requires a `contactId` — cannot send to bare phone number directly
- Steps: `GET /contacts/?locationId=...&query=phone` → create if not found → send

### `medication-reminders` — cron SMS reminders
- **File:** `supabase/functions/medication-reminders/index.ts`
- **Cron:** every 5 minutes (`*/5 * * * *`) — set in Supabase Dashboard → Edge Functions → Schedule
- **Flow:** find active meds with reminder_enabled=true → check ±5min window → skip if taken → skip if reminder_logs exists → send SMS → log to reminder_logs
- **NOTE:** This function still uses the OLD GHL endpoint (`/conversations/messages/outbound`) — needs updating to match send-sms contact-lookup flow

### Deploy command
```bash
SUPABASE_ACCESS_TOKEN=<token> /c/Users/Ryanr/bin/supabase.exe functions deploy <function-name> --project-ref ynsakoxsmuvwfjgbhxky --no-verify-jwt
```
- Token: `sbp_9c4d988f47762fa77d32eb3c9d0929318633a46c`
- CLI binary: `/c/Users/Ryanr/bin/supabase.exe` (v2.75.0, downloaded manually)
- Use `SUPABASE_ACCESS_TOKEN` env var (not `--token` flag — unsupported in this version)

### SMS helper — `src/lib/sms.js`
```js
const EDGE_FN_URL = 'https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/send-sms'
export async function sendSMS(to, message) { ... }
```

---

## GHL (GoHighLevel) SMS

- **API key:** stored as Supabase secret `GHL_API_KEY` (starts with `pit-...`)
- **Location ID:** `qvSvBqNwvDLyqkKoZXl2` (stored as `GHL_LOCATION_ID`)
- **From phone:** `+13367336462` (stored as `GHL_PHONE_NUMBER`)
- **Endpoint:** `POST https://services.leadconnectorhq.com/conversations/messages`
- **Required header:** `Version: 2021-04-15`
- **Requires:** `contactId` (must look up or create contact first)
- **Status:** A2P SMS registration pending — texts fire but carrier may hold delivery during registration

---

## Environment Variables

### Vercel (client-side, VITE_ prefix)
```
VITE_SUPABASE_URL=https://ynsakoxsmuvwfjgbhxky.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
VITE_ANTHROPIC_API_KEY=<anthropic key>
```

### Local `.env` (also has GHL vars for reference, but SMS runs server-side)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_ANTHROPIC_API_KEY=...
VITE_GHL_API_KEY=...         (reference only — real key is Supabase secret)
VITE_GHL_LOCATION_ID=...
VITE_GHL_PHONE_NUMBER=...
VITE_APP_URL=https://senior-safe-hazel.vercel.app
```

### Supabase Secrets (server-side, edge functions)
```
GHL_API_KEY
GHL_LOCATION_ID
GHL_PHONE_NUMBER
```

---

## File Structure

```
seniorsafe/
├── src/
│   ├── main.jsx                    # React entry point
│   ├── App.jsx                     # BrowserRouter + all routes + ProtectedRoute
│   ├── index.css                   # Tailwind v4 @import + @theme custom colors
│   ├── lib/
│   │   ├── supabase.js             # Supabase client (VITE_SUPABASE_PUBLISHABLE_KEY)
│   │   └── sms.js                  # sendSMS() helper calling edge function
│   ├── components/
│   │   └── BottomNav.jsx           # Fixed bottom nav: Home/Vault/Family/AI tabs
│   └── pages/
│       ├── WelcomePage.jsx         # /  — logo, Get Started, Sign In buttons
│       ├── SignUpPage.jsx          # /signup — admin flow + ?code= member invite flow
│       ├── SignInPage.jsx          # /signin
│       ├── OnboardingPage.jsx      # /onboarding — 6 questions, upserts user_profile
│       ├── DashboardPage.jsx       # /dashboard — I'm Okay, glance cards, bottom nav
│       ├── VaultPage.jsx           # /vault — document upload/list/delete
│       ├── AIPage.jsx              # /ai — voice AI chat, 50 msg beta limit
│       ├── ContactPage.jsx         # /contact — Ryan's contact info
│       ├── MedicationsPage.jsx     # /medications — daily checklist, SMS reminders
│       ├── AppointmentsPage.jsx    # /appointments — list, add, .ics calendar download
│       ├── FamilyPage.jsx          # /family — messages tab + photos tab
│       ├── FamilyInvitePage.jsx    # /family-invite — invite code display + member list
│       ├── EmergencyPage.jsx       # /emergency — first responder card, edit mode
│       ├── ProfilePage.jsx         # /profile — name, phone, SMS toggle
│       ├── TermsPage.jsx           # /terms — ToS (public, no auth required)
│       └── PrivacyPage.jsx         # /privacy — privacy policy (public, no auth required)
├── supabase/
│   └── functions/
│       ├── send-sms/index.ts       # Edge fn: GHL contact lookup + SMS send
│       └── medication-reminders/index.ts  # Cron edge fn: scheduled med reminders
├── public/
├── index.html
├── vite.config.js
├── package.json
└── .env                            # Local only, not committed
```

---

## All Routes (App.jsx)

```jsx
// Public (no auth)
<Route path="/"              element={<WelcomePage />} />
<Route path="/signup"        element={<SignUpPage />} />
<Route path="/signin"        element={<SignInPage />} />
<Route path="/terms"         element={<TermsPage />} />
<Route path="/privacy"       element={<PrivacyPage />} />

// Protected (ProtectedRoute wrapper)
<Route path="/onboarding"    element={<P><OnboardingPage /></P>} />
<Route path="/dashboard"     element={<P><DashboardPage /></P>} />
<Route path="/vault"         element={<P><VaultPage /></P>} />
<Route path="/ai"            element={<P><AIPage /></P>} />
<Route path="/contact"       element={<P><ContactPage /></P>} />
<Route path="/medications"   element={<P><MedicationsPage /></P>} />
<Route path="/appointments"  element={<P><AppointmentsPage /></P>} />
<Route path="/family"        element={<P><FamilyPage /></P>} />
<Route path="/emergency"     element={<P><EmergencyPage /></P>} />
<Route path="/family-invite" element={<P><FamilyInvitePage /></P>} />
<Route path="/profile"       element={<P><ProfilePage /></P>} />
```

### ProtectedRoute pattern
Uses `useState(undefined)` — `undefined`=loading, `null`=no session, object=authenticated.
Returns `null` while loading to prevent flash-redirect to signin.

---

## Key Components & Patterns

### BottomNav (`src/components/BottomNav.jsx`)
- 4 tabs: Home (`/dashboard`), Vault (`/vault`), Family (`/family`), AI (`/ai`)
- Prop: `inline={true}` renders as normal flow element; default is `position: fixed` bottom
- Used on DashboardPage (fixed), AIPage (inline for flex layouts)
- Active tab uses `strokeWidth={2.5}`, inactive `strokeWidth={1.5}`

### Family invite system
- Admin has `family_code` (6-char uppercase) in `user_profile`
- Share link: `https://senior-safe-hazel.vercel.app/signup?code=XXXXXX`
- Member flow: `/signup?code=XXXXXX` → MemberSignup component → creates user_profile with `role='member'`, `invited_by=admin.user_id`, `onboarding_complete=true` → goes straight to dashboard
- FamilyInvitePage: if `family_code` is null for admin, auto-generates and saves one

### OnboardingPage (admin flow only)
- 6 steps: loved one's name, age, living situation, timeline, biggest concern, phone (optional)
- `STEPS` array with `optional: true` flag for phone step
- `canAdvance()` returns `true` for optional steps regardless of value
- Final upsert: generates `family_code` inline if not in metadata (safety net)
- Saves to `user_profile` with `onboarding_complete: true`, then `setStep(TOTAL)` → completion screen

### DashboardPage — roles
- `profile.role === 'member'` → member view (sees admin's check-in status, can send reminder)
- `!isMember` → admin view (sees "I'm Okay" button, check-in sends SMS to all members + self)
- Check-in self-SMS: "✅ Your I'm Okay check-in was recorded and your family has been notified - SeniorSafe"
- Member warning banner shown if `isMember && adminCheckInLoaded && !adminCheckIn && hours >= 10`

### AIPage — key details
- Direct Anthropic API calls from browser (requires `anthropic-dangerous-direct-browser-access: true` header)
- Model: `claude-opus-4-5`
- Env var: `VITE_ANTHROPIC_API_KEY`
- 50-message beta limit: tracked in `user_profile.message_count` / `message_limit`
- Uses refs (`msgCountRef`, `msgLimitRef`, `userIdRef`, `profileRef`, `soundOnRef`) to avoid stale closures in async handlers
- Limit message: "You've reached your 50 message beta limit. You're clearly serious about protecting your family — that's exactly who I was built for. Text Ryan directly at (336) 553-8933 to get full access and personalized help."
- Counter below input: gray → yellow at 40+ → red at 48+
- SYSTEM_PROMPT includes all 19 Blueprint modules for context-aware responses
- Voice: uses Web Speech API (`speechSynthesis`) with sound toggle

### AppointmentsPage — key details
- Types: Medical, Dental, Vision, Therapy, Other (color-coded chips)
- `downloadIcs(appt)` generates `.ics` file and triggers browser download
- Filters: upcoming (≥ today) shown by default, past appointments section collapsible
- Table: `appointments` with columns `title`, `appointment_date`, `appointment_time`, `provider_name`, `appointment_type`, `location`, `notes`

### EmergencyPage — key details
- First responder card: blood type, allergies, current meds summary, primary doctor, 2 emergency contacts, insurance
- `BLOOD_TYPES` array: ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
- Edit mode toggled with Edit2/Save icons
- Table: `emergency_info` with `user_id` (unique per user)

### VaultPage — key details
- Camera icon triggers file input (accepts images + PDF)
- Category filter: All, Legal, Medical, Financial, Personal
- Upload flow: storage upload → get public URL → insert to `documents` table
- Delete: extracts path from URL using `/object/public/Documents/` marker, removes from storage + DB
- **Storage bucket: `Documents` (capital D)**

### MedicationsPage — key details
- Frequencies: Once daily, Twice daily, Three times daily, As needed
- Default times auto-set per frequency
- Dose status: taken (green), overdue (red), upcoming (gray)
- SMS reminder toggle: saves `reminder_enabled` + `reminder_phone` to medications table
- Pre-fills `reminder_phone` from `user_profile.phone`

### FamilyPage — key details
- Two tabs: Messages and Photos
- Messages: text + optional photo, displays family thread
- Photos: grid view with fullscreen lightbox, upload button
- **Storage bucket: `Documents` (capital D)** for both photos and message attachments
- Tables: `family_messages` (message_text, photo_url, author_name), `family_photos` (photo_url, uploaded_by)

---

## Business Context

- **Ryan Riggins** — Licensed NC Realtor #361546, eXp Realty, (336) 553-8933, ryan@rigginsstrategicsolutions.com
- **Revenue model:**
  - $47 — Senior Transition Blueprint (PDF/guide)
  - $12–25/month — SeniorSafe app subscription
  - $1,500–2,500 — Private consultations
  - Referral fees from senior communities
- **Blueprint buyers** get 3 months free app access (access code system not yet built)
- **Stripe** not yet integrated — beta is currently free
- **Contact page** (`/contact`) has Ryan's direct info for client outreach

---

## Known Issues / Pending Work

1. **medication-reminders edge function** still uses old GHL endpoint (`/conversations/messages/outbound`) — needs updating to match the `send-sms` contact-lookup flow (`/conversations/messages` with contactId). Redeploy after fixing.

2. **A2P SMS registration** pending with GHL — texts fire successfully but carrier may hold delivery during registration window.

3. **Blueprint access code system** not built — future feature to grant app access to Blueprint buyers.

4. **Stripe payments** not integrated — all beta access is free currently.

5. **Pending SQL** (if not yet run in Supabase):
   ```sql
   ALTER TABLE user_profile
     ADD COLUMN IF NOT EXISTS sms_notifications boolean DEFAULT true,
     ADD COLUMN IF NOT EXISTS message_count int DEFAULT 0,
     ADD COLUMN IF NOT EXISTS message_limit int DEFAULT 50;
   ```

6. **medication-reminders cron** must be set in Supabase Dashboard → Edge Functions → medication-reminders → Schedule → `*/5 * * * *`

---

## Git / Deploy Workflow

```bash
# Normal deploy
git add <files>
git commit -m "description"
git push  # Vercel auto-deploys

# Deploy edge function
SUPABASE_ACCESS_TOKEN=sbp_9c4d988f47762fa77d32eb3c9d0929318633a46c \
  /c/Users/Ryanr/bin/supabase.exe functions deploy <fn-name> \
  --project-ref ynsakoxsmuvwfjgbhxky --no-verify-jwt
```

Git config for this repo:
- user.email: ryan@rigginsstrategicsolutions.com
- user.name: Ryan Riggins
