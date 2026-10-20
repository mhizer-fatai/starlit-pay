-- Starlit Pay: passkey auth layer (run after schema.sql in the Supabase SQL editor)
-- Tables are reachable only through the backend's service role, like the rest of the schema.

-- One-time WebAuthn challenges (consumed with DELETE ... RETURNING)
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'stepup')),
    challenge TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON public.webauthn_challenges(expires_at);

-- Registered passkeys (public keys only)
CREATE TABLE IF NOT EXISTS public.passkeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[] NOT NULL DEFAULT '{}',
    device_type TEXT,
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    prf_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    device_name VARCHAR(64),
    pending_until TIMESTAMPTZ,          -- set when added through account recovery
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON public.passkeys(user_id);

-- Encrypted master seed (the server cannot decrypt it)
CREATE TABLE IF NOT EXISTS public.key_vault (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    encrypted_seed TEXT NOT NULL,
    version SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- The vault data key, wrapped once per unlock method
CREATE TABLE IF NOT EXISTS public.vault_wraps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('passkey', 'pin', 'recovery')),
    passkey_id UUID REFERENCES public.passkeys(id) ON DELETE CASCADE,
    wrapped_dek TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT vault_wraps_passkey_link CHECK ((method = 'passkey') = (passkey_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_wraps_passkey ON public.vault_wraps(passkey_id) WHERE passkey_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_wraps_method ON public.vault_wraps(user_id, method) WHERE passkey_id IS NULL;

-- PIN verifier (HMAC under a key outside the database) and per-account attempt limiting
CREATE TABLE IF NOT EXISTS public.pin_guard (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    salt TEXT NOT NULL,
    params JSONB NOT NULL,
    verifier_mac TEXT NOT NULL,
    server_share_enc TEXT NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    lock_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Recovery code verifier (HMAC only; the code itself is never stored)
CREATE TABLE IF NOT EXISTS public.recovery_codes (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    code_mac TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    used_at TIMESTAMPTZ
);

-- Rotating refresh tokens (stored as HMACs), grouped into session families
CREATE TABLE IF NOT EXISTS public.auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    family_id UUID NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    amr TEXT[] NOT NULL,
    auth_time TIMESTAMPTZ NOT NULL,
    passkey_id UUID REFERENCES public.passkeys(id) ON DELETE SET NULL,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family ON public.auth_sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON public.auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_passkey ON public.auth_sessions(passkey_id);

-- Reserves one PIN attempt atomically (row lock), so parallel guesses cannot
-- exceed the limit. Returns whether the attempt may proceed.
CREATE OR REPLACE FUNCTION public.reserve_pin_attempt(p_user UUID, p_max INT, p_base_lock_seconds INT)
RETURNS TABLE(o_allowed BOOLEAN, o_attempts INT, o_locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    g public.pin_guard%ROWTYPE;
BEGIN
    SELECT * INTO g FROM public.pin_guard WHERE user_id = p_user FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    IF g.locked_until IS NOT NULL AND g.locked_until > NOW() THEN
        RETURN QUERY SELECT FALSE, g.failed_attempts, g.locked_until;
        RETURN;
    END IF;

    -- A lock that has expired starts a fresh window.
    IF g.locked_until IS NOT NULL THEN
        g.failed_attempts := 0;
    END IF;

    -- Limit reached without a recorded lock (e.g. a crash mid-request): lock now.
    IF g.failed_attempts >= p_max THEN
        UPDATE public.pin_guard
           SET locked_until = NOW() + make_interval(secs => p_base_lock_seconds), updated_at = NOW()
         WHERE user_id = p_user
     RETURNING locked_until INTO g.locked_until;
        RETURN QUERY SELECT FALSE, g.failed_attempts, g.locked_until;
        RETURN;
    END IF;

    UPDATE public.pin_guard
       SET failed_attempts = g.failed_attempts + 1, locked_until = NULL, updated_at = NOW()
     WHERE user_id = p_user;
    RETURN QUERY SELECT TRUE, g.failed_attempts + 1, NULL::TIMESTAMPTZ;
END;
$$;

-- After a wrong PIN: once the limit is reached, lock with exponential backoff.
-- Concurrent failures share one lock (and one backoff step) instead of stacking.
CREATE OR REPLACE FUNCTION public.record_pin_failure(p_user UUID, p_max INT, p_base_lock_seconds INT, p_max_lock_seconds INT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_locked TIMESTAMPTZ;
BEGIN
    UPDATE public.pin_guard
       SET locked_until = NOW() + make_interval(secs => LEAST(p_base_lock_seconds * POWER(2, lock_count), p_max_lock_seconds)),
           lock_count = lock_count + 1,
           updated_at = NOW()
     WHERE user_id = p_user
       AND failed_attempts >= p_max
       AND (locked_until IS NULL OR locked_until <= NOW())
 RETURNING locked_until INTO v_locked;

    IF v_locked IS NULL THEN
        SELECT locked_until INTO v_locked FROM public.pin_guard WHERE user_id = p_user AND locked_until > NOW();
    END IF;
    RETURN v_locked;
END;
$$;

-- Insert or replace the wrapped data key for one unlock method.
CREATE OR REPLACE FUNCTION public.upsert_vault_wrap(p_user UUID, p_method TEXT, p_passkey UUID, p_wrapped_dek TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF p_passkey IS NULL THEN
        INSERT INTO public.vault_wraps (user_id, method, passkey_id, wrapped_dek)
        VALUES (p_user, p_method, NULL, p_wrapped_dek)
        ON CONFLICT (user_id, method) WHERE passkey_id IS NULL
        DO UPDATE SET wrapped_dek = EXCLUDED.wrapped_dek, updated_at = NOW();
    ELSE
        INSERT INTO public.vault_wraps (user_id, method, passkey_id, wrapped_dek)
        VALUES (p_user, p_method, p_passkey, p_wrapped_dek)
        ON CONFLICT (passkey_id) WHERE passkey_id IS NOT NULL
        DO UPDATE SET wrapped_dek = EXCLUDED.wrapped_dek, updated_at = NOW();
    END IF;
END;
$$;

-- Row Level Security: backend (service role) only
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_wraps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to webauthn_challenges" ON public.webauthn_challenges;
DROP POLICY IF EXISTS "Service role full access to passkeys" ON public.passkeys;
DROP POLICY IF EXISTS "Service role full access to key_vault" ON public.key_vault;
DROP POLICY IF EXISTS "Service role full access to vault_wraps" ON public.vault_wraps;
DROP POLICY IF EXISTS "Service role full access to pin_guard" ON public.pin_guard;
DROP POLICY IF EXISTS "Service role full access to recovery_codes" ON public.recovery_codes;
DROP POLICY IF EXISTS "Service role full access to auth_sessions" ON public.auth_sessions;

CREATE POLICY "Service role full access to webauthn_challenges" ON public.webauthn_challenges
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to passkeys" ON public.passkeys
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to key_vault" ON public.key_vault
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to vault_wraps" ON public.vault_wraps
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to pin_guard" ON public.pin_guard
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to recovery_codes" ON public.recovery_codes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to auth_sessions" ON public.auth_sessions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Functions are callable only by the backend
REVOKE ALL ON FUNCTION public.reserve_pin_attempt(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_pin_failure(UUID, INT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_vault_wrap(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_pin_attempt(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_pin_failure(UUID, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_vault_wrap(UUID, TEXT, UUID, TEXT) TO service_role;
