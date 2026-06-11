-- 2026-06-11 (security audit #18 + #28) — both non-breaking defense-in-depth.
-- #18: daily_quotes / family_context / notification_log / ai_user_budgets /
--   maggie_usage are server-written but grant anon+authenticated INSERT/UPDATE/DELETE
--   at the Postgres level; they're safe today only because RLS has no permissive write
--   policy. Revoke the grants so the GRANT layer matches intent (writes only via
--   service_role). RLS already denied these, so no behavior change.
-- #28: enable RLS (deny-all, no policies) on every backups.* table. The backups schema
--   is already sealed (zero grants), so this is belt-and-suspenders against a future
--   accidental GRANT USAGE ON SCHEMA backups.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_quotes','family_context','notification_log','ai_user_budgets','maggie_usage'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='backups' AND c.relkind='r' AND NOT c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE backups.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
