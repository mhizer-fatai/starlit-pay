-- Starlit Pay: lock every public table to the backend (service role) only.
--
-- Run in the Supabase SQL editor AFTER the backend is deployed with
-- SUPABASE_SERVICE_ROLE_KEY. The frontend never reads tables directly (it only
-- uses Supabase Auth for Google sign-in), so nothing in the app needs the anon
-- or authenticated roles to see table data.
--
-- Safe to re-run.

-- 1. Show what is exposed right now (read the result before continuing).
SELECT tablename, policyname, roles, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, policyname;

-- 2. Drop every policy that grants anything to anon, authenticated or public,
--    enable RLS on every table, and remove direct table privileges.
DO $$
DECLARE
    p RECORD;
    t RECORD;
BEGIN
    FOR p IN
        SELECT tablename, policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
        RAISE NOTICE 'Dropped policy % on %', p.policyname, p.tablename;
    END LOOP;

    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 3. Verify: this should return no rows.
SELECT tablename, policyname, roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND roles && ARRAY['anon', 'authenticated', 'public']::name[];
