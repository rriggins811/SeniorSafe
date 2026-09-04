# SeniorSafe — Grok Bot Execution Brief

**Date:** 2026-09-04  
**Owner:** Ryan Riggins  
**Purpose:** Do the remaining work. Do not re-plan. Do not debate product. Spend tokens on execution only.

Hand this file to Grok Bot (the environment with **Supabase + GitHub**). This chat (Grok Build) does **not** have a Supabase connector and must not keep doing half the job.

---

## 0. Who you are and what you are allowed to do

You are executing a live consumer app already on the App Store and Google Play.

- Repo: `https://github.com/rriggins811/SeniorSafe` (public, default branch `main`)
- Web: `https://app.seniorsafeapp.com` (Vercel project `senior-safe`, team `rriggins811s-projects`, project id `prj_61hnZE8RSIAQvIfjOEnfGw41BPYG`)
- Supabase project ref: `ynsakoxsmuvwfjgbhxky`
- Bundle id / applicationId: `com.rigginsstrategicsolutions.seniorsafe`
- Current store version: **1.1.1** / Android `versionCode` **6**
- Next store version: **1.1.2** / Android `versionCode` **7**
- Stack: Vite + React 19 + Capacitor 8 + Supabase + RevenueCat IAP
- Project bible in repo: `CLAUDE.md` — obey it for conventions; this brief overrides it on product split (parent vs adult child, AI vs Maggie)

**Do**

- Finish unfinished work from 2026-08-19
- Deploy the `ai-chat` edge function
- Tighten stability and parent/child UX on the existing code
- Push to `main` (or a short-lived branch + merge) so Vercel ships web
- Bump native version numbers and leave Ryan a 6-line archive checklist

**Do not**

- Rebuild the app from scratch
- Add features, new tabs, new plugins, new permissions, new IAP products
- Invite a 2.0 store review
- Put a `/preview` route or demo toggle in production
- Give the parent Maggie
- Give SeniorSafe AI Blueprint / Medicaid / estate / housing knowledge
- Paste secrets into chat, commits, or this file
- Touch `seniorsafe-site`, `blueprint-site`, `rss-site`, or GHL unless a bug in SeniorSafe requires it
- Spend the first hour rediscovering the product. Read this file and go.

---

## 1. Product (locked — do not reopen)

SeniorSafe is a family check-in app.

Two users, two homes, two AIs.

### Parent (role `admin` on the parent phone)

Kiosk. Huge tap targets. No bottom tab bar.

On screen:

1. **I'm Okay Today** (check-in)
2. **I Need Help** (family SMS alert + 911 offer)
3. **Ask a question** → `/ai` SeniorSafe AI
4. Meds row only if doses remain today
5. Speed-dial of family contacts if present
6. More (⋯) sheet: Settings, Sign out, Call 911

Not on the parent home: Vault, Family feed, Maggie, 5-tab nav, Blueprint, documents, transition planning.

### Adult child (role `member`)

Morning board. Bottom nav: **Home / Vault / Family / Maggie**. No SeniorSafe AI tab.

On Home:

- Status hero: checked in / waiting / overdue, last check-in time
- Nudge if still waiting
- Today: meds due, next appointment, unread family messages
- If you need it: Vault, ER card, Maggie
- Call parent

### AIs

| Who | Tool | Job |
|---|---|---|
| Parent | SeniorSafe AI (`ai-chat`, `/ai`) | Everyday only: recipes, weather (no live weather — send to Weather app / Google), birthday cards, simple how-tos |
| Adult child | Maggie (`maggie-chat`, `/maggie`) | Blueprint, transitions, Medicaid/Medicare education, estates/trusts/POA overview, housing. Legal disclaimer. Not licensed advice. |

If parent asks legal / money / moving / Medicaid / will / trust / assisted living: **refuse and redirect**. Do not give a “quick overview anyway.”

Example redirect (warm, short):

> That's not something I can help with. For legal, money, or moving questions, ask your family or look it up on Google. Your family has a helper named Maggie for those. I can help with recipes, cards, or everyday how-tos — want one of those?

Maggie already redirects recipes/weather/chitchat to SeniorSafe AI. Keep that.

---

## 2. What is already done (do not redo)

Shipped to GitHub `main` and Vercel production on **2026-08-19**:

Commit: `4dddf80ccd321683ef1c8d3913106d77046950c9`  
PR: https://github.com/rriggins811/SeniorSafe/pull/1 (merged, squash)

Files already on main:

- `src/components/homes/ParentHome.jsx`
- `src/components/homes/FamilyHome.jsx`
- `src/components/homes/HelpModal.jsx`
- `src/pages/DashboardPage.jsx` — branches `role === 'member'` → FamilyHome, else ParentHome
- `src/components/BottomNav.jsx` — returns `null` unless `role === 'member'`; member tabs are Home / Vault / Family / Maggie
- `src/pages/AIPage.jsx` — everyday starters; BottomNav only if member
- `supabase/functions/ai-chat/index.ts` — **new strict parent prompt is in the repo**

Dashboard already loads meds/appointments **family-scoped** (not `user_id` only) so the adult child sees the parent’s day.

**Not done**

1. Live `ai-chat` function almost certainly still running the **old** Blueprint-dump prompt. Repo has the new prompt. Production function was never deployed from this workstream (no Supabase connector here).
2. Native binaries still **1.1.1 / versionCode 6**. Phones do not have the new homes until Ryan archives.
3. Stability / empty / error / loading polish was planned and not executed.
4. Confirm Vercel production still matches `4dddf80` or later. As of 2026-09-04 it did.

---

## 3. Work order (do in this order)

### Job A — Deploy `ai-chat` (first, no store)

The parent AI brain is the only change that can go live on phones **today** without a store build.

1. Confirm repo file `supabase/functions/ai-chat/index.ts` still starts with:

   `You are SeniorSafe AI, a simple everyday helper for an older adult`

   If it has been reverted to “family coordination assistant” + Blueprint/Medicaid corpus, restore the strict prompt (full text in §5).

2. Deploy:

   ```bash
   npx supabase functions deploy ai-chat --project-ref ynsakoxsmuvwfjgbhxky
   ```

   Use whatever auth you already have. Do not print keys.

3. Verify live:

   POST `https://ynsakoxsmuvwfjgbhxky.supabase.co/functions/v1/ai-chat`  
   Ask: `How do I get Mom on Medicaid?`  
   Required: refuse + send to family / Google / Maggie.  
   Forbidden: look-back period, spend-down, document list, Blueprint pitch.

   Ask: `What's a good recipe for chicken soup?`  
   Required: an actual simple recipe.

   Ask: `What's the weather today?`  
   Required: no live weather; Weather app or Google.

4. If deploy fails, stop and report the exact error. Do not “fix it” by putting the old prompt back.

### Job B — Stability + friendliness on existing homes

Do not invent a third IA. Polish what shipped.

**Must fix if present**

- Dashboard blank screen / uncaught crash when profile, meds, appointments, or messages fail. Show the home shell + a one-line retry.
- `role` missing or wrong: treat unknown as parent kiosk only if the account is the family admin; members must never land on the parent kiosk.
- Parent visiting `/medications` or `/ai` must have a back-to-home control and **no Maggie tab**.
- Member visiting `/ai` (deep link): either keep the page or send them to Maggie. Do not put SeniorSafe AI in their tab bar.
- Check-in, help alert, and Ask must remain tappable with one thumb. Do not shrink parent buttons to “fit more.”
- Family meds and next appointment on the child board must keep using family scope, not `user_id` of the child.
- Loading: parent home should still show I'm Okay / Help while data loads. Do not block the kiosk on a spinner.
- Empty child board: “Waiting on check-in” is the hero. Do not fill the page with upsell.

**Nice if cheap (same PR)**

- Parent Ask empty-state copy stays everyday-only (already started in AIPage).
- Child “If you need it” stays 3 cards: Vault, ER, Maggie.
- Error copy in plain English. No stack traces. No “as an AI.”

**Out of scope for this pass**

- New pairing / invite redesign
- Digest SMS server work
- Tasks table
- Redesign of Vault, Family chat, Maggie UI, IAP paywalls
- Marketing site

### Job C — Version bump for the later native archive

Ryan will archive in Xcode / Android Studio himself. Prepare the repo so he does not have to hunt numbers.

- `android/app/build.gradle`: `versionCode 7`, `versionName "1.1.2"`
- iOS: `MARKETING_VERSION` / `CFBundleShortVersionString` **1.1.2**, `CURRENT_PROJECT_VERSION` / `CFBundleVersion` increment by 1 from whatever is currently in `ios/`
- Store “What's New” draft (put in the PR body, do not submit):

  > Improvements to the parent home and family home. Everyday helper for parents. Stability fixes.

No new CocoaPods, no new Gradle plugins, no new Capacitor plugins, no Info.plist permission strings, no Play permission group changes.

### Job D — Ship web

1. Commit on `main` or merge a short branch.
2. Confirm Vercel production deployment for `senior-safe` is READY on that SHA.
3. Spot-check `https://app.seniorsafeapp.com` sign-in page loads.
4. Leave Ryan this exact native checklist and then stop:

```text
git pull origin main
npm install
npm run build
npx cap sync
# Xcode: Archive 1.1.2
# Android Studio: bundle versionCode 7 / 1.1.2
```

Do **not** submit to App Store Connect or Play Console unless Ryan explicitly says so in that session.

---

## 4. Key files (go here first)

| File | Why |
|---|---|
| `src/pages/DashboardPage.jsx` | Role split, data load, check-in / help handlers |
| `src/components/homes/ParentHome.jsx` | Parent kiosk |
| `src/components/homes/FamilyHome.jsx` | Adult-child board |
| `src/components/homes/HelpModal.jsx` | Help confirm / sent / failed |
| `src/components/BottomNav.jsx` | Member-only 4 tabs |
| `src/pages/AIPage.jsx` | Parent everyday chat UI |
| `src/pages/MaggiePage.jsx` | Do not strip disclaimers |
| `supabase/functions/ai-chat/index.ts` | Parent AI prompt — deploy this |
| `supabase/functions/maggie-chat/` | Adult-child specialist — do not merge into ai-chat |
| `android/app/build.gradle` | versionCode / versionName |
| `ios/` Xcode project / Info.plist | 1.1.2 bump |
| `CLAUDE.md` | Conventions, tables, IAP notes |

Capacitor `webDir` is the Vite `dist/` bundle. Native update = rebuild `dist` + `cap sync`. Same JS as web.

---

## 5. Required `ai-chat` system prompt (if you must restore it)

Use this as `BASE_SYSTEM_PROMPT` in `supabase/functions/ai-chat/index.ts`. Do not append Blueprint, Medicaid, estate, or housing corpora.

```
You are SeniorSafe AI, a simple everyday helper for an older adult using the SeniorSafe app.

WHO YOU ARE:
- A kind, patient neighbor who has time to talk
- Simple words. Short sentences. Short paragraphs.
- Use the person's first name when you know it
- Never say "as an AI" or "I'm just a language model"
- Never make anyone feel silly for asking
- Never rush them

WHAT YOU HELP WITH — this is the whole job:
- Recipes and cooking
- Everyday how-tos (writing a birthday card, using a phone setting, packing a bag for an appointment)
- Light conversation, jokes, trivia, memories
- General non-legal, non-medical questions
- Weather: you do NOT have live weather. Tell them to open the Weather app on their phone or ask Google for their city.

CRITICAL SAFETY — NEVER VIOLATE:
- NEVER diagnose, interpret labs, or suggest treatments
- NEVER recommend starting, stopping, or changing medications, dosages, or supplements
- NEVER give medication interaction or side-effect advice
- NEVER suggest home remedies for medical conditions
- If asked anything medical: "I'm not able to give medical advice — that's for your doctor. If this is an emergency, tap I Need Help on your home screen or call 911."
- If they describe an emergency (chest pain, can't breathe, stroke, fall and can't get up, heavy bleeding, suicide): tell them to call 911 or tap I Need Help right now. Do not keep chatting.

LEGAL, MONEY, AND MOVING ARE OFF LIMITS:
You do not answer — not even a "quick overview" — on:
- Wills, trusts, probate, power of attorney, guardianship, contracts
- Medicaid, Medicare strategy, spend-down, look-back, VA benefits planning
- Estates, inheritance, who gets the house
- Assisted living, memory care, CCRC, nursing homes, selling the house, cash buyers, or whether they should move
- Investments, taxes, or financial advice
- The Senior Transition Blueprint (that is Maggie's job for their adult children)

WHEN THE QUESTION IS NOT GENERAL:
Warmly redirect and stop. Do not summarize the topic anyway.
Say something like: "That's not something I can help with. For legal, money, or moving questions, ask your family or look it up on Google. Your family has a helper named Maggie for those. I can help with recipes, cards, or everyday how-tos — want one of those?"

Keep answers short: 2–4 short paragraphs unless they ask for more.
```

Keep existing auth, usage limits, streaming, and emergency-keyword behavior in `ai-chat`. Only the system prompt + “what you know about this user” should stay narrow. Do not feed living-situation / timeline / biggest-concern into a transition lecture.

---

## 6. How to report back to Ryan

One short message when done:

1. `ai-chat` deployed: yes/no + Medicaid-question result (one sentence)
2. Web SHA live on Vercel
3. Files changed
4. Native bump in repo: 1.1.2 / versionCode 7 (yes/no)
5. Anything you did **not** finish

No essays. No new product ideas unless something is broken in production.

---

## 7. Context this other Grok already burned tokens on (do not repeat)

Aug 2026 session with Grok Build reviewed the live app and GitHub, then implemented the parent/child split in-repo, previewed it, pushed to main, and Vercel auto-deployed the UI. The session could not deploy Supabase functions. Ryan has not archived 1.1.2 yet. He asked that the next bot do the whole remaining job because splitting work across an environment without Supabase wastes usage.

That is the whole brief. Start at Job A.
