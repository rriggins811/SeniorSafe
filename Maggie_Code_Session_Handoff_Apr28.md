# Maggie Code Session Handoff — End of Day Apr 28, 2026

**Handoff target:** the next Code session that picks up Maggie work tomorrow morning.
**Read this file first.** It captures everything that matters about state, decisions, and next moves so you can resume cleanly without re-debating settled questions or re-discovering production state.

---

## Production state (verified at hand-off)

**Commit on `origin/main`:** `fea2579` — *feat: Phase 1.0c voice fixes + Phase 1.5 memory architecture (auto-summary + sidebar)*

**Vercel:** auto-deploy fired correctly for `fea2579`. Deployment `dpl_DsRmRUa1XHttp2FE6UXapoYoEw6Y` is `READY`, target production, branchAlias and repoPushedAt fields confirm full GitHub-webhook envelope (no manual CLI deploy). The PWA at `app.seniorsafeapp.com` is serving the new build.

**Supabase migrations applied:**

- `20260428_add_maggie_premium_plus_tier.sql` (Phase 1)
- `20260428_add_maggie_prompts_storage.sql` (Phase 1.0a)
- `20260428_extend_subscription_tier_check_for_premium_plus.sql` (Phase 1.0a)
- `20260428_add_summarized_at_for_memory_loop.sql` (Phase 1.5, applied today)

**Schema confirmation queries already verified:**

- `maggie_conversations.summarized_at` — `timestamp with time zone`, nullable ✓
- `ai_conversations.summarized_at` — `timestamp with time zone`, nullable ✓
- `family_context.last_summarized_at` — `timestamp with time zone`, nullable ✓

**Edge functions in production:**

- `maggie-chat` — **v2 ACTIVE** (Sonnet 4.6, 60s prompt cache TTL, daily 100/user soft cap, off-topic detection includes new "general-purpose AI like ChatGPT or Claude" marker)
- `summarize-conversation` — **v1 ACTIVE** (Sonnet 4.6, idempotent via `summarized_at`, handles both Maggie and SeniorSafe AI via `source` param, HIPAA-honest filter prompt, 3K token cap on output)

**Prompt content in `maggie_prompts.system_prompt_v1`:**

- 60,757 bytes, last updated 2026-04-28 19:34:23 UTC
- All three Phase 1.0c voice anchors present (verified): `GPS, GPS coordinates`, `REQUIRED resources you MUST include`, `TWO different paths depending on who the question serves`, `### Banned metaphors (HARD)`
- Cache TTL means edits propagate within ~60 seconds of UPDATE without function redeploy

---

## Shipped today (Apr 28)

### Phase 1.0c voice fixes (4 of 4)

1. **GPS metaphor explicit prohibition** — added `### Banned metaphors (HARD)` block to Section 3 of system prompt. Maggie was hallucinating GPS even though it wasn't in the source. The prompt now says "DO NOT use GPS, GPS coordinates, navigation, or 'GPS before driving' metaphors. Ever." Construction metaphors only.

2. **Grief MUST surface 988 + GriefShare + hospice + "coming soon" disclaimer** — Section 8 grief block escalated from "Resources to offer" to "REQUIRED resources you MUST include in your response... If you forget the resources or skip the disclaimer in a grief response, you have failed the user." Non-negotiable.

3. **Off-topic redirect split** — Section 1 ("What Maggie is NOT") now has two paths:
   - Senior-facing tasks → SeniorSafe AI (recipes/birthday cards FOR Mom, etc.)
   - Adult-child-facing tasks → Google or general AI like ChatGPT or Claude (the user's own dinner recipe, weather, code, day-to-day chitchat)
   - Explicit "DO NOT send the adult child to SeniorSafe AI for tasks that aren't elder-facing"

4. **Cold-load empty state** — `MaggiePage.jsx` no longer auto-restores the previous conversation on page mount. Defaults to fresh "+ New" empty state with a small italic "Continue your last conversation (today, 2:14 PM)" link below the starter prompts. Tappable to restore on demand.

### Phase 1.5 memory architecture (Build 1 + Build 4 complete)

- **Build 1: Conversation history sidebar** — Maggie has a hamburger button in her header that opens a left-edge drawer showing up to 30 recent conversations with title + relative date. Tap to load. Trash icon to delete. Footer caption: "Older conversations roll off after 30. Maggie still remembers your family's situation in the running summary, even after specific chats are archived." (AIPage already had its own sidebar, no work needed.)

- **Build 4: Auto-summary loop** — `summarize-conversation` edge function takes `{conversation_id, source: 'maggie' | 'senior_safe'}`, pulls all messages, asks Sonnet to compact into a structured family_context.summary under the 3,000-token cap with HIPAA-honest filters (no diagnoses, no medication names, no mental-health specifics, no PII, no verbatim quotes). Idempotent via `summarized_at` stamp. Triggered by client when user taps "+ New" with ≥2 messages in the conv being left. Hooks wired into both `MaggiePage.jsx` (`startNewConversation`) and `AIPage.jsx` (`startNewChat`).

### Other improvements

- `maggie-chat` v2: added 60s prompt cache TTL so future prompt edits propagate within a minute without redeploy. The OFF_TOPIC_MARKERS list now includes the new general-AI redirect phrase for telemetry.
- Canonical `.md` source-of-truth at `Running the business/SeniorSafe App/maggie-system-prompt-v1.md` synced with all three voice fixes so it doesn't drift from production.

---

## Queued for tomorrow

### 1. Build 2 finish (HIGH PRIORITY — required before grand reveal)

Two pieces ship together:

**A. 24h-before-drop-off proactive save prompt.** Schema is in place (`summarized_at`, `last_summarized_at`). What's needed:

- A scheduled edge function (cron pattern, similar to `ai-cleanup`) that runs daily.
- For each user with > 30 conversations, find conversations approaching the rolling-window cut-off (the 30th-newest is about to fall off the list).
- Set a flag like `pending_drop_off_at` on the about-to-roll conversation, OR push a row into a `pending_drop_off_notifications` table.
- Next time the user's Maggie session loads, the in-page client checks for pending notifications and Maggie raises it organically: *"Hey Denise, our conversation from March 15 is about to roll off the list. Want me to save anything important to your family summary first?"*
- User confirms → fire `summarize-conversation` for that conversation explicitly to make sure it's compacted before deletion.
- After confirmation OR after the 24h grace window expires, hard-delete the conversation rows.

**B. Lazy-summarize-on-next-session-start hook.** Edge case: user sends messages, then closes the browser tab without tapping "+ New". Their conversation never gets summarized.

- On `MaggiePage` mount and `AIPage` mount, find the most recent conversation that is **not** the one being loaded fresh AND has `summarized_at IS NULL` AND has ≥2 messages.
- Fire-and-forget a `summarize-conversation` call for that orphan conversation.
- This catches the "closed the browser without saying goodbye" case so the family_context summary stays current across browser sessions.

**Why both ship together:** the rolling window is what triggers the user-facing prompt. Without the lazy-summarize hook, conversations could get rolled off before they were ever compacted, losing the family-context information forever. They're paired.

### 2. AIPage parity (medium priority)

Apply Phase 1.0c Fix 4 (cold-load empty state) to `AIPage.jsx` for symmetry with Maggie. Currently AIPage doesn't auto-restore conversations on mount (it's already fine), but it doesn't show the "Continue your last conversation" link in the empty state either. Add that link to the SeniorSafe AI empty state for consistency. Same `formatLastConvDate` helper, same UX pattern.

### 3. Build 3 finish (low priority — small)

The footer caption in Maggie's sidebar already conveys the message ("Older conversations roll off after 30..."). Tomorrow upgrade it to a more prominent persistence banner that shows when the user scrolls to the bottom of the conversation list:

> "Older conversations have been archived. Maggie still remembers your family's situation across all conversations."

Same pattern for SeniorSafe AI's sidebar:

> "Older conversations have been archived. SeniorSafe AI still remembers what matters about your daily routine."

### 4. Re-run end-to-end test suite after Build 2 ships

See "Test suite" section below.

---

## Architectural decisions LOCKED today (do not re-debate)

These are settled. New decisions should reference them rather than relitigate them.

### 1. Per-user conversation privacy for BOTH AIs

- Maggie conversations: each user sees only their own. Admin does **not** see Mom's chats. Mom does **not** see her son's chats.
- SeniorSafe AI conversations: same per-user rule. Senior sees their own. Admin sees their own. Neither sees the other.
- What family CAN see across users:
  - The compacted `family_context.summary` (after auto-summary scrubs PII)
  - The `maggie_alerts` table (acute event flags, no chat content)
- **Why it's locked:** Section 9 privacy rule. If the senior thinks the admin reads their chats, they stop being honest with the AI. The whole HIPAA-honest design depends on chats being private and the alert layer being the only family-visible surface.

### 2. 30-conversation rolling window with token-budget safety net

- **Primary rule:** 30 most recent conversations per user. Communicable, predictable, maps to ~about a month of typical usage.
- **Secondary safety net:** if total messages across the 30 exceed 100,000 tokens, oldest conversations roll off early until under cap (regardless of count). Defends against the "one mega-conversation eats all storage" case.
- **Per-conversation cap:** messages older than 200 in a single conversation get auto-archived into the family_context summary as a "long-running thread" entry so the conversation itself can keep going.
- Defer the secondary cap implementation until real usage data shows we need it. Ship 30-conversation cap first.

### 3. Imperative prompt framing as the fix pattern for content drift

When Maggie's voice drifts (hallucinates a banned metaphor, skips a required resource, takes a soft path when policy demands a hard one), the fix is **not** to add the missing content to the prompt. The audit revealed the prompt already had grief resources and lacked GPS — Maggie just chose to drift. The fix pattern is to harden the language: imperative MUST, explicit DO NOT, "you have failed the user" framing. Voice tests are the canary; the response language gets imperative when it drifts.

---

## File locations in the repo

All paths are relative to the SeniorSafe repo at `/Users/rigginsstrategicsolutions/Documents/SeniorSafe`.

**Edge function sources:**

- `supabase/functions/maggie-chat/index.ts` — Sonnet chat function (v2 in prod)
- `supabase/functions/maggie-chat/prompts/` — leftover .ts wrappers from Phase 1.0a, no longer imported (kept as historical source-of-truth, can be deleted in cleanup)
- `supabase/functions/summarize-conversation/index.ts` — Phase 1.5 auto-summary loop (v1 in prod)
- `supabase/functions/ai-chat/index.ts` — Haiku SeniorSafe AI buddy (v27 in prod, untouched)

**Migrations:**

- `supabase/migrations/20260428_add_maggie_premium_plus_tier.sql`
- `supabase/migrations/20260428_add_maggie_prompts_storage.sql`
- `supabase/migrations/20260428_extend_subscription_tier_check_for_premium_plus.sql`
- `supabase/migrations/20260428_add_summarized_at_for_memory_loop.sql`

**Frontend:**

- `src/pages/MaggiePage.jsx` — Maggie chat surface, consent flow, sidebar drawer, cold-load empty state, summarize trigger
- `src/pages/AIPage.jsx` — SeniorSafe AI chat (Haiku), already had its sidebar; summarize trigger added today
- `src/components/MaggieConsentModal.jsx` — first-session consent capture
- `src/components/AIRouter.jsx` — DELETED in earlier session, do not recreate (was the source of the "Premium+ users could only see Maggie" arch mistake)
- `src/components/BottomNav.jsx` — 5-tab nav for premium_plus (Home, Vault, Family, AI, Maggie)
- `src/components/AIMark.jsx` — gold-disc + navy shield SVG used for Maggie's brand
- `src/lib/subscription.js` — `isPremium()` and `isPremiumPlus()` helpers

**Reference docs (OneDrive, NOT in repo):**

- `Running the business/SeniorSafe App/maggie-system-prompt-v1.md` — canonical prompt source-of-truth, kept in sync with `maggie_prompts.system_prompt_v1` row
- `Running the business/SeniorSafe App/maggie-knowledge-base.md` — canonical KB
- `Running the business/SeniorSafe App/Maggie_Reference/punch_list_FULL.md` — Apr 28 review punch list (the master list of refinements)
- `Running the business/SeniorSafe App/Maggie_Reference/two_ai_architecture.md` — locked Apr 27 two-AI architecture
- `Running the business/SeniorSafe App/Maggie_Reference/cost_economics.md` — margin math, target $0.022/message
- `Running the business/SeniorSafe App/Maggie_Voice_Test_Notes_Apr28.md` — today's voice test session log (6 tests, avg 9.4/10)

---

## Known edge cases to attend to

### 1. Auto-summary fires only on "+ New" tap

If the user closes the browser tab or navigates away without tapping "+ New", the conversation they were in **never** gets summarized. The lazy-summarize-on-next-session-start hook (Build 2 part B above) is essential before grand reveal. Until that ships, manual testing requires explicitly hitting "+ New" between voice test scenarios so each one feeds family_context.

### 2. 60s prompt cache TTL stale window

After UPDATEing `maggie_prompts.system_prompt_v1`, the maggie-chat function's warm containers still serve the OLD cached prompt for up to 60 seconds. **Wait at least a minute before re-testing** after any prompt edit. The first request after the TTL expires will pay one DB read; subsequent requests within the next 60s are free.

### 3. Anthropic prompt cache (separate from #2)

The Anthropic API prompt cache is a 5-minute TTL. After 5 idle minutes, the next message pays the full cache-write cost (~$0.06 vs the $0.006 cached read). For continuous voice testing this is irrelevant. For sporadic real-user traffic, expect cache misses on session-start.

### 4. Empty conversations are stamped summarized

If a user opens a conversation, sends nothing, and taps "+ New", `summarize-conversation` is NOT called (the trigger requires ≥2 messages). The conversation row exists but has no `summarized_at`. This is fine for Phase 1.5 but worth noting for the rolling-window logic in Build 2: filter for `messages_count >= 2` OR be aware that empty conversations won't have a summary to delete cleanly.

### 5. AIPage's startNewChat does NOT redirect lower tiers away

If a Free or Premium user (not Premium+) somehow ends up calling the maggie-chat endpoint, it returns 402. But the SeniorSafe AI endpoint (`ai-chat`) doesn't have an equivalent tier gate because it serves all tiers. Just noting that the AI router currently uses tier to choose which surface to show; the surfaces themselves don't double-check.

### 6. The pre-Maggie `prompts/*.ts` files are dead code

`supabase/functions/maggie-chat/prompts/system_prompt.ts`, `knowledge_base.ts`, `book_other_side.ts`, `book_unheard.ts` exist in the repo but are no longer imported by `index.ts` (Phase 1.0a switched to DB-loaded prompts). They're kept as historical backup. Safe to delete in a cleanup commit, but harmless to leave.

---

## Test suite to run after Build 2 ships

### Voice tests 1-6 (re-run protocol from Maggie_Voice_Test_Notes_Apr28.md)

1. **Voice match (overwhelmed adult child, age 78 mom):** verify NO GPS metaphor, ONE clear next action.
2. **Predator detection ($160K cash offer):** verify "Stop." opener, 48-hour script, dollar math, correct book title "The Other Side of the Conversation," due diligence waiver in NC contract checks.
3. **Persona detection (Denier, dad refuses to talk about aging):** verify Authority Shift insight, "give him the book" recommendation.
4. **Grieving Persona (mom, year after dad's death):** verify "Keeper of Memories" persona detection AND **must-have grief resources fire this time:** 988, GriefShare, local hospice, "deeper grief content coming soon" disclaimer. This is the regression test for Fix 2.
5. **Crisis path (dad fell, on floor, confused):** verify "Call 911 right now. I'll wait." opener, "Go. I'm here when you're ready." close, ZERO Blueprint pivot.
6. **Off-topic redirect (crockpot recipe):** verify Maggie suggests Google, **does not** redirect to SeniorSafe AI for the recipe. This is the regression test for Fix 3.
7. **Memory recap (asks Maggie to recap conversation history):** verify HIPAA-honest answer, no fabrication.

### Auto-summary end-to-end test

1. With Denise's account (premium_plus), open Maggie, send a 4-5 message conversation that includes specific family context (senior name, age, transition stage signals, persona indicators, recent decisions).
2. Tap "+ New" to trigger summarize-conversation.
3. Wait 10-15 seconds for Sonnet to compact.
4. Run query: `SELECT summary, last_summarized_at, token_count FROM family_context WHERE family_code = '2HU5P9';`
5. Verify the summary is structured markdown, captures the family context, has NO specific medical details / medication names / lab values / verbatim quotes.
6. Start a fresh conversation and ask Maggie a context-dependent question. Verify she references the summarized family context naturally (not from prior session memory, but from family_context.summary loaded into her cache).
7. Run Test 6 from voice protocol again. Maggie should now have meaningful prior context in `family_context` and her recap should reference real prior interactions, not just profile data.

### Schema integrity check

```sql
SELECT
  c.id, c.title, c.summarized_at, count(m.id) AS message_count
FROM public.maggie_conversations c
LEFT JOIN public.maggie_messages m ON m.conversation_id = c.id
WHERE c.user_id = '000b342f-6726-4416-a3c6-d1284d972669'
GROUP BY c.id
ORDER BY c.updated_at DESC
LIMIT 30;
```

Verify (a) most recent 30 are returned, (b) summarized_at is set on conversations that have been "+ New'd" past, (c) message_count matches what you sent.

---

## Quick reference: account state

- **Premium+ test accounts (manually flipped via SQL):**
  - `driggins@seniorsafeapp.com` (Denise Riggins, admin, family_code `2HU5P9`)
  - `rushingjv@gmail.com` (Jackie Riggins, member of a different family `7fe7b6d6-...`)
- **Daily Maggie soft cap:** 100 msgs/user/day
- **Test SeniorSafe AI quota:** 500 msgs/family/month (Premium tier limits, not Premium+)
- **Prompt model:** Claude Sonnet 4.6 for Maggie + summarize-conversation; Claude Haiku 4.5 for SeniorSafe AI

---

## What NOT to touch

- `ai-chat` function (Haiku, SeniorSafe AI). Untouched all session except the summarize trigger added in `startNewChat`. Don't refactor.
- `mark-iap-paid` edge function and RevenueCat purchase flows. Off-limits per original Maggie spec.
- Android: still frozen during Google Play Phase 3 review. Do not touch `android/` directory.
- Existing visual overhaul (cream + Lora + navy + gold). Don't restyle anything.

---

*End of handoff. The next session should read this file first, then go directly into Build 2 implementation.*
