-- 2026-09-04 One assistant (Maggie) for everyone. Ryan's decision, see
-- RSS-Business/SeniorSafe App/AI_MERGE_PLAN_2026-09-04.md.
--
-- 1. Fold Maggie's conversation history into the shared tables. Both pairs of
--    tables have identical columns and UUID ids, so this is a straight copy.
-- 2. Anyone who accepted Maggie's consent screen has consented to the one
--    assistant; do not ask them again.
-- 3. The old maggie_* tables stay for 30 days as a safety net. Drop them after
--    2026-10-04 with supabase/migrations/20261004_drop_maggie_tables.sql
--    (not written yet on purpose).
--
-- Safe to run more than once: the inserts skip rows that already exist.
-- Rollback: delete from ai_messages where conversation_id in (select id from maggie_conversations);
--           delete from ai_conversations where id in (select id from maggie_conversations);

INSERT INTO public.ai_conversations (id, user_id, family_code, title, created_at, updated_at, summarized_at)
SELECT id, user_id, family_code, title, created_at, updated_at, summarized_at
FROM public.maggie_conversations
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_messages (id, conversation_id, role, content, created_at)
SELECT m.id, m.conversation_id, m.role, m.content, m.created_at
FROM public.maggie_messages m
WHERE EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = m.conversation_id)
ON CONFLICT (id) DO NOTHING;

UPDATE public.user_profile p
   SET ai_consent = true,
       ai_consent_date = COALESCE(p.ai_consent_date, c.consented_at, now())
  FROM public.maggie_consent c
 WHERE c.user_id = p.user_id
   AND c.ai_disclosure_acked = true
   AND p.ai_consent = false;

-- What moved, for the record.
SELECT
  (SELECT count(*) FROM public.maggie_conversations) AS maggie_conversations,
  (SELECT count(*) FROM public.ai_conversations WHERE id IN (SELECT id FROM public.maggie_conversations)) AS now_in_ai_conversations,
  (SELECT count(*) FROM public.maggie_messages) AS maggie_messages,
  (SELECT count(*) FROM public.ai_messages WHERE id IN (SELECT id FROM public.maggie_messages)) AS now_in_ai_messages,
  (SELECT count(*) FROM public.user_profile WHERE ai_consent) AS consented_users;
