-- Starlit Pay: archive of the private pools' contract events (real ZK).
-- Stellar RPC keeps only ~7 days of events, but a new device needs the whole
-- history to find its notes, so the backend keeps every event and serves it
-- the way Nethermind's SPP bootnode does. Events are public chain data.
-- Run in the Supabase SQL editor after schema_gateway.sql. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.zk_events (
    id           TEXT PRIMARY KEY,          -- RPC event id: ledger order when sorted
    ledger       INTEGER NOT NULL,
    contract_id  TEXT NOT NULL,
    payload      JSONB NOT NULL,            -- the event exactly as RPC returned it
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zk_events_ledger ON public.zk_events(ledger, id);

-- Backend (service role) only, like every other table.
ALTER TABLE public.zk_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zk_events FROM anon, authenticated;
