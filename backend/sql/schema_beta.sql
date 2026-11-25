-- Starlit Pay: closed beta ("Founding Testers").
--
-- While sign-up is invite-only, a new account gets in if its Google email
-- belongs to an approved application, or with an invite code.
--
-- beta_applications people who applied to join (e.g. from X); approving one
--                   lets that Gmail address sign up with no code.
-- beta_invites      codes: group codes (many uses, shared in a community) and
--                   golden tickets (one use, three per tester, to invite friends).
-- beta_redemptions  which account used which code (one code per account).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.beta_invites (
    code        TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('group', 'golden')),
    owner_id    UUID REFERENCES public.users(id) ON DELETE CASCADE,
    label       TEXT,
    max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    uses        INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beta_invites_owner_idx ON public.beta_invites (owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.beta_redemptions (
    code        TEXT NOT NULL REFERENCES public.beta_invites(code) ON DELETE CASCADE,
    user_id     UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code, user_id)
);

CREATE TABLE IF NOT EXISTS public.beta_applications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_token     TEXT NOT NULL UNIQUE,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    x_handle         TEXT,
    telegram_handle  TEXT,
    persona          TEXT NOT NULL,
    reason           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS beta_applications_status_idx ON public.beta_applications (status, created_at);

-- Only the backend (service role) reads or writes these tables.
ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beta_invites, public.beta_redemptions, public.beta_applications FROM anon, authenticated;
