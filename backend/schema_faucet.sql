-- Starlit Pay: faucet cooldown on the user row (it was kept in a file that
-- every deploy wiped). Run in the Supabase SQL editor before deploying. Safe to re-run.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS faucet_claimed_at TIMESTAMPTZ;
