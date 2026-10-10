-- Per-account settings for Starlit Pay (Supabase / Postgres)
-- Run once in the Supabase dashboard SQL editor (or psql connected as owner).
-- The backend reads/writes this table; no code changes needed after applying.

CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    language VARCHAR(10) DEFAULT 'en' NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD' NOT NULL,
    notif_email BOOLEAN DEFAULT true NOT NULL,
    notif_push BOOLEAN DEFAULT true NOT NULL,
    notif_sms BOOLEAN DEFAULT false NOT NULL,
    notif_marketing BOOLEAN DEFAULT false NOT NULL,
    sec_passkey BOOLEAN DEFAULT true NOT NULL,
    sec_google BOOLEAN DEFAULT true NOT NULL,
    sec_email BOOLEAN DEFAULT true NOT NULL,
    sec_phone BOOLEAN DEFAULT false NOT NULL,
    sec_password BOOLEAN DEFAULT true NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Set up Row Level Security (backend-only access, same as other tables)
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to user_settings" ON public.user_settings;

CREATE POLICY "Service role full access to user_settings" ON public.user_settings
    FOR ALL TO service_role USING (true) WITH CHECK (true);
