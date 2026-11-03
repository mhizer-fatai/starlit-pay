-- SQL schema defining the shielded notes cache table for Supabase
CREATE TABLE IF NOT EXISTS public.shielded_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commitment TEXT UNIQUE NOT NULL,
    encrypted_note TEXT NOT NULL,
    recipient_viewing_key TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'unspent' CHECK (status IN ('unspent', 'spent')) NOT NULL,
    root VARCHAR(64),
    ledger BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index to quickly query unspent notes by recipient viewing key
CREATE INDEX IF NOT EXISTS idx_shielded_notes_viewing_key ON public.shielded_notes(recipient_viewing_key);
CREATE INDEX IF NOT EXISTS idx_shielded_notes_commitment ON public.shielded_notes(commitment);
