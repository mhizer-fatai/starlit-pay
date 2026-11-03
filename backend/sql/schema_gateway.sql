-- Starlit Pay: gateway deposits are processed exactly once, and background
-- jobs keep their position in the database instead of on Render's disk, which
-- is wiped on every deploy.
--
-- Run in the Supabase SQL editor BEFORE deploying the backend that uses it.
-- Safe to re-run.

-- One row per incoming payment operation. The primary key is the payment
-- itself, so a payment can be credited once, whatever the recipient's keys are.
CREATE TABLE IF NOT EXISTS public.gateway_deposits (
    tx_hash       TEXT NOT NULL,
    op_index      INTEGER NOT NULL,
    memo          TEXT,
    amount        TEXT NOT NULL,
    asset         TEXT NOT NULL,
    commitment    TEXT,
    pool_tx_hash  TEXT,
    status        TEXT NOT NULL CHECK (status IN ('processing', 'submitted', 'done', 'failed', 'needs_review', 'legacy')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tx_hash, op_index)
);
CREATE INDEX IF NOT EXISTS idx_gateway_deposits_retry ON public.gateway_deposits(status, updated_at)
    WHERE status IN ('processing', 'submitted', 'failed');

-- Positions of background jobs (gateway cursor, indexer ledger).
CREATE TABLE IF NOT EXISTS public.daemon_state (
    name        TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backend (service role) only, like every other table.
ALTER TABLE public.gateway_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daemon_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_deposits FROM anon, authenticated;
REVOKE ALL ON public.daemon_state FROM anon, authenticated;
