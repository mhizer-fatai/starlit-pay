-- Starlit Pay: each user's public keys for the private pools (real ZK proofs),
-- so others can pay them by username. Run in the Supabase SQL editor after
-- schema.sql. Safe to re-run.
--
-- zk_keys_signature is the user's own Stellar key signing both keys (SEP-53),
-- so neither a stolen session nor the server can swap them unnoticed.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS zk_note_key TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS zk_encryption_key TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS zk_keys_signature TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS zk_keys_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_zk_note_key ON public.users(zk_note_key) WHERE zk_note_key IS NOT NULL;
