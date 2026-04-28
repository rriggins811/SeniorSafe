-- Phase 1.5 memory architecture
--
-- summarized_at: when the auto-summary loop has compacted this conversation
--   into family_context. Once set, the conversation is eligible for the
--   rolling-window drop-off (Build 2). NULL means not yet summarized.
--
-- Same column on maggie_conversations and ai_conversations because the
-- summarize-conversation edge function handles both (the architecture doc
-- says the memory pattern applies to both AIs).
--
-- Applied to production via Supabase MCP on April 28, 2026.

ALTER TABLE public.maggie_conversations
  ADD COLUMN IF NOT EXISTS summarized_at timestamptz;

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS summarized_at timestamptz;

CREATE INDEX IF NOT EXISTS maggie_conversations_summarized_idx
  ON public.maggie_conversations (user_id, summarized_at);

CREATE INDEX IF NOT EXISTS ai_conversations_summarized_idx
  ON public.ai_conversations (user_id, summarized_at);

-- last_summarized_at tracks the most recent successful summarization for the
-- family_context row, so we can show "still remembers everything" UI without
-- exposing individual conversation content.
ALTER TABLE public.family_context
  ADD COLUMN IF NOT EXISTS last_summarized_at timestamptz;
