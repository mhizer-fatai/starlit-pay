-- Starlit Pay, phase 3. Run in the Supabase SQL editor before deploying. Safe to re-run.

-- One payment settles one payment link: the claiming transaction is recorded
-- and may appear on one link only.
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS claim_tx_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_links_claim_tx_hash
    ON public.payment_links(claim_tx_hash) WHERE claim_tx_hash IS NOT NULL;
