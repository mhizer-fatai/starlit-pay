-- Starlit Pay: passkey auth layer, update 2 (run after schema_auth.sql). Safe to re-run.
--
-- profile_bound_at: when the profile's public keys (encryption key, Stellar
-- address) were set to this vault's keys. New sign-ups are bound when the vault
-- is created. Accounts migrated from email+PIN keys are bound once, after their
-- funds have moved to the new keys. A bound profile's keys can never be
-- swapped again, so a stolen session cannot redirect incoming payments.

ALTER TABLE public.key_vault ADD COLUMN IF NOT EXISTS profile_bound_at TIMESTAMPTZ;

-- Every vault created before this update came from a passkey sign-up, whose
-- profile already holds the vault's keys.
UPDATE public.key_vault SET profile_bound_at = created_at WHERE profile_bound_at IS NULL;

-- Points the profile at the vault's public keys exactly once (row lock on the vault).
CREATE OR REPLACE FUNCTION public.bind_profile_keys(
    p_user UUID,
    p_public_encryption_key TEXT,
    p_stellar_address TEXT,
    p_identity_commitment TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_bound TIMESTAMPTZ;
BEGIN
    UPDATE public.key_vault
       SET profile_bound_at = NOW(), updated_at = NOW()
     WHERE user_id = p_user AND profile_bound_at IS NULL
 RETURNING profile_bound_at INTO v_bound;

    IF v_bound IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE public.users
       SET public_encryption_key = p_public_encryption_key,
           stellar_address = p_stellar_address,
           identity_commitment = p_identity_commitment
     WHERE id = p_user;
    RETURN TRUE;
END;
$$;

-- Uses a recovery code exactly once.
CREATE OR REPLACE FUNCTION public.consume_recovery_code(p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_used TIMESTAMPTZ;
BEGIN
    UPDATE public.recovery_codes
       SET used_at = NOW()
     WHERE user_id = p_user AND used_at IS NULL
 RETURNING used_at INTO v_used;
    RETURN v_used IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_profile_keys(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_recovery_code(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_profile_keys(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_recovery_code(UUID) TO service_role;
