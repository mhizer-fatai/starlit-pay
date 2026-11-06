-- Starlit Pay: gateway deposits into the real-ZK private pools (SPP).
-- A payment to the gateway is recorded once, as before, then kept as the
-- user's credit; their browser proves the deposit and the gateway signs it as
-- the depositor. Run in the Supabase SQL editor after schema_gateway.sql.
-- Safe to re-run.

ALTER TABLE public.gateway_deposits ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.gateway_deposits ADD COLUMN IF NOT EXISTS claim_tx_hash TEXT;
ALTER TABLE public.gateway_deposits ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

-- 'credited': waiting for the user's device; 'claiming': a signed deposit may land.
ALTER TABLE public.gateway_deposits DROP CONSTRAINT IF EXISTS gateway_deposits_status_check;
ALTER TABLE public.gateway_deposits ADD CONSTRAINT gateway_deposits_status_check
    CHECK (status IN ('processing', 'submitted', 'done', 'failed', 'needs_review', 'legacy', 'credited', 'claiming'));

CREATE INDEX IF NOT EXISTS idx_gateway_deposits_credits ON public.gateway_deposits(user_id, status)
    WHERE status IN ('credited', 'claiming');
