-- Starlit Pay: public smart wallet (OpenZeppelin smart account) per user.
-- Run in the Supabase SQL editor after schema_auth_v2.sql. Safe to re-run.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS smart_wallet_address TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS smart_wallet_created_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_smart_wallet ON public.users(smart_wallet_address) WHERE smart_wallet_address IS NOT NULL;
