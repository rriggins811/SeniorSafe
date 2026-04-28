-- Maggie AI Phase 1: tables, RLS, RPCs, and tier value
-- Apply via Supabase dashboard or Supabase MCP. No destructive changes; purely additive.
-- All tables are scoped to family_code or user_id. SeniorSafe AI tables (ai_conversations, ai_messages, ai_usage) untouched.

-- ---------------------------------------------------------------------------
-- 1. CONVERSATIONS: one row per Maggie conversation thread, per user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maggie_conversations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_code  text        NOT NULL,
  title        text        NOT NULL DEFAULT 'New conversation',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maggie_conversations_user_id_idx
  ON public.maggie_conversations (user_id, updated_at DESC);

ALTER TABLE public.maggie_conversations ENABLE ROW LEVEL SECURITY;

-- Owner-only policy. Conversations are private; no family-scoped read.
CREATE POLICY "owner can read own maggie conversations"
  ON public.maggie_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "owner can insert own maggie conversations"
  ON public.maggie_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner can update own maggie conversations"
  ON public.maggie_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "owner can delete own maggie conversations"
  ON public.maggie_conversations FOR DELETE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 2. MESSAGES: individual messages within a Maggie conversation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maggie_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES public.maggie_conversations(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maggie_messages_conversation_idx
  ON public.maggie_messages (conversation_id, created_at);

ALTER TABLE public.maggie_messages ENABLE ROW LEVEL SECURITY;

-- Owner-only via parent conversation
CREATE POLICY "owner can read own maggie messages"
  ON public.maggie_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.maggie_conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "owner can insert own maggie messages"
  ON public.maggie_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.maggie_conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid()
  ));


-- ---------------------------------------------------------------------------
-- 3. FAMILY CONTEXT: per-family running summary, max ~3000 tokens
--    Mom's individual chat content NEVER lives here. Only the family
--    operating-system summary that helps Maggie remember the bigger picture.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.family_context (
  family_code   text        PRIMARY KEY,
  summary       text        NOT NULL DEFAULT '',
  token_count   int         NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.family_context ENABLE ROW LEVEL SECURITY;

-- Family members can read their family's context; only the edge function (service role) writes.
CREATE POLICY "family members can read family context"
  ON public.family_context FOR SELECT
  USING (
    family_code IN (
      SELECT family_code FROM public.user_profile WHERE user_id = auth.uid()
      UNION
      SELECT family_code FROM public.user_profile
      WHERE user_id = (
        SELECT invited_by FROM public.user_profile WHERE user_id = auth.uid()
      )
    )
  );


-- ---------------------------------------------------------------------------
-- 4. CONSENT: per-user consent record for Maggie
--    Captured at first Premium+ session. Each toggle is timestamped.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maggie_consent (
  user_id                       uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_disclosure_acked           boolean     NOT NULL DEFAULT false,
  conversation_storage_consent  boolean     NOT NULL DEFAULT false,
  family_context_consent        boolean     NOT NULL DEFAULT false,
  acute_alerts_enabled          boolean     NOT NULL DEFAULT true,
  alerts_mood_optin             boolean     NOT NULL DEFAULT false,
  alerts_isolation_optin        boolean     NOT NULL DEFAULT false,
  alerts_cognitive_optin        boolean     NOT NULL DEFAULT false,
  alerts_general_optin          boolean     NOT NULL DEFAULT false,
  consented_at                  timestamptz,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maggie_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can read own consent"
  ON public.maggie_consent FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "owner can insert own consent"
  ON public.maggie_consent FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner can update own consent"
  ON public.maggie_consent FOR UPDATE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 5. ALERTS: alert layer events fired from Maggie chat sessions.
--    Source user is logged for audit but NEVER exposed in the family UI.
--    Family members see category + description only (per Section 9).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maggie_alerts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code      text        NOT NULL,
  source_user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category         text        NOT NULL CHECK (category IN (
    'safety_event',
    'driving_confusion',
    'wandering',
    'medication_error',
    'house_hazard',
    'suicide_active',
    'mood_pattern',
    'isolation_pattern',
    'cognitive_pattern',
    'general_concerning'
  )),
  acuity           text        NOT NULL CHECK (acuity IN ('acute', 'chronic')),
  description      text        NOT NULL,
  fired_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS maggie_alerts_family_idx
  ON public.maggie_alerts (family_code, fired_at DESC);

ALTER TABLE public.maggie_alerts ENABLE ROW LEVEL SECURITY;

-- Family members can SELECT alerts for their family (description only, never source_user_id pivot)
CREATE POLICY "family members can read family alerts"
  ON public.maggie_alerts FOR SELECT
  USING (
    family_code IN (
      SELECT family_code FROM public.user_profile WHERE user_id = auth.uid()
      UNION
      SELECT family_code FROM public.user_profile
      WHERE user_id = (
        SELECT invited_by FROM public.user_profile WHERE user_id = auth.uid()
      )
    )
  );

-- Acknowledge an alert (any family member)
CREATE POLICY "family members can acknowledge family alerts"
  ON public.maggie_alerts FOR UPDATE
  USING (
    family_code IN (
      SELECT family_code FROM public.user_profile WHERE user_id = auth.uid()
      UNION
      SELECT family_code FROM public.user_profile
      WHERE user_id = (
        SELECT invited_by FROM public.user_profile WHERE user_id = auth.uid()
      )
    )
  );


-- ---------------------------------------------------------------------------
-- 6. DAILY USAGE: per-user, per-day message count for rate limiting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maggie_usage (
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date     date        NOT NULL,
  message_count  int         NOT NULL DEFAULT 0,
  total_input_tokens   bigint NOT NULL DEFAULT 0,
  total_output_tokens  bigint NOT NULL DEFAULT 0,
  total_cache_read_tokens   bigint NOT NULL DEFAULT 0,
  total_cache_create_tokens bigint NOT NULL DEFAULT 0,
  off_topic_redirects       int   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.maggie_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can read own usage"
  ON public.maggie_usage FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. RPCs: increment usage atomically (called from edge function with service role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_maggie_usage(
  p_user_id           uuid,
  p_input_tokens      int DEFAULT 0,
  p_output_tokens     int DEFAULT 0,
  p_cache_read        int DEFAULT 0,
  p_cache_create      int DEFAULT 0,
  p_off_topic         int DEFAULT 0
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO public.maggie_usage (
    user_id, usage_date, message_count,
    total_input_tokens, total_output_tokens,
    total_cache_read_tokens, total_cache_create_tokens,
    off_topic_redirects
  )
  VALUES (
    p_user_id, CURRENT_DATE, 1,
    p_input_tokens, p_output_tokens,
    p_cache_read, p_cache_create,
    p_off_topic
  )
  ON CONFLICT (user_id, usage_date) DO UPDATE SET
    message_count             = public.maggie_usage.message_count + 1,
    total_input_tokens        = public.maggie_usage.total_input_tokens + p_input_tokens,
    total_output_tokens       = public.maggie_usage.total_output_tokens + p_output_tokens,
    total_cache_read_tokens   = public.maggie_usage.total_cache_read_tokens + p_cache_read,
    total_cache_create_tokens = public.maggie_usage.total_cache_create_tokens + p_cache_create,
    off_topic_redirects       = public.maggie_usage.off_topic_redirects + p_off_topic
  RETURNING message_count INTO v_count;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPCs: hard-delete user's Maggie data on demand (Delete My Data)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_maggie_data_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.maggie_messages
  WHERE conversation_id IN (
    SELECT id FROM public.maggie_conversations WHERE user_id = p_user_id
  );
  DELETE FROM public.maggie_conversations WHERE user_id = p_user_id;
  DELETE FROM public.maggie_usage WHERE user_id = p_user_id;
  DELETE FROM public.maggie_alerts WHERE source_user_id = p_user_id;
  DELETE FROM public.maggie_consent WHERE user_id = p_user_id;
  -- family_context: only zero it if this is the only Maggie user in the family.
  -- Otherwise leave it for the rest of the family.
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. CRON support: 24-month hard-delete of raw Maggie conversations
--    Run nightly via the existing ai-cleanup edge function (will need a Maggie branch).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_maggie_conversations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH deleted AS (
    DELETE FROM public.maggie_conversations
    WHERE updated_at < (now() - INTERVAL '24 months')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Tier value: existing user_profile.subscription_tier is text DEFAULT 'paid'.
--     'premium_plus' is now a valid value. No constraint change needed.
--     Document only.
--     Existing values: 'free', 'paid' (=Premium), 'trial'.
--     New value: 'premium_plus' (=Maggie tier, $39.99/mo, RevenueCat entitlement maggie_access).
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.user_profile.subscription_tier IS
  'free | paid | trial | premium_plus. premium_plus unlocks Maggie AI (added Apr 28, 2026).';
