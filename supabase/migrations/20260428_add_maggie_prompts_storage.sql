-- Storage table for Maggie's prompt assets (system prompt + knowledge base).
-- Edge function reads from this on cold start and caches in memory.
-- Avoids bundling ~135KB of prompt text inside the function source.
-- Applied to production via Supabase MCP on April 28, 2026.

CREATE TABLE IF NOT EXISTS public.maggie_prompts (
  name        text        PRIMARY KEY,
  content     text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maggie_prompts ENABLE ROW LEVEL SECURITY;

-- No public read policy. Only the edge function (service role) reads this.
-- No insert/update policies for end users.

COMMENT ON TABLE public.maggie_prompts IS
  'Maggie system prompt + KB content, fetched by maggie-chat edge function on cold start.';

-- Two rows are populated separately (UPSERT via execute_sql with dollar-quoted content).
-- Expected rows: system_prompt_v1, knowledge_base_v1.
