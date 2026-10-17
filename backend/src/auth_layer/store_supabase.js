// Supabase/Postgres store for the passkey auth layer. Requires backend/schema_auth.sql.
// Operations that must be atomic are single statements or Postgres functions.

function check({ data, error }) {
  if (error) throw new Error(`Auth store error: ${error.message}`);
  return data;
}

export function createSupabaseStore(supabase) {
  const nowIso = () => new Date().toISOString();

  return {
    async findUserByEmail(email) {
      return check(await supabase.from("users").select("*").eq("email", email.toLowerCase()).maybeSingle());
    },
    async findUserById(id) {
      return check(await supabase.from("users").select("*").eq("id", id).maybeSingle());
    },

    async createChallenge({ userId, purpose, challenge, expiresAt }) {
      const row = check(
        await supabase
          .from("webauthn_challenges")
          .insert({ user_id: userId, purpose, challenge, expires_at: expiresAt })
          .select("id")
          .single()
      );
      return row.id;
    },
    async consumeChallenge(id) {
      // DELETE ... RETURNING: exactly one caller can take a challenge.
      return check(await supabase.from("webauthn_challenges").delete().eq("id", id).select("*").maybeSingle());
    },

    async listPasskeys(userId) {
      return check(await supabase.from("passkeys").select("*").eq("user_id", userId).order("created_at"));
    },
    async findPasskeyByCredentialId(credentialId) {
      return check(await supabase.from("passkeys").select("*").eq("credential_id", credentialId).maybeSingle());
    },
    async insertPasskey(p) {
      return check(
        await supabase
          .from("passkeys")
          .insert({
            user_id: p.userId,
            credential_id: p.credentialId,
            public_key: p.publicKey,
            counter: p.counter,
            transports: p.transports,
            device_type: p.deviceType,
            backed_up: p.backedUp,
            prf_enabled: p.prfEnabled,
            device_name: p.deviceName,
            pending_until: p.pendingUntil ?? null,
          })
          .select("*")
          .single()
      );
    },
    async updatePasskeyUsage(id, { counter, backedUp, lastUsedAt }) {
      check(await supabase.from("passkeys").update({ counter, backed_up: backedUp, last_used_at: lastUsedAt }).eq("id", id));
    },
    async revokePasskey(id, at) {
      check(await supabase.from("passkeys").update({ revoked_at: at }).eq("id", id).is("revoked_at", null));
    },

    async getVault(userId) {
      return check(await supabase.from("key_vault").select("*").eq("user_id", userId).maybeSingle());
    },
    async createVault(userId, { encryptedSeed, version }) {
      const { error } = await supabase
        .from("key_vault")
        .insert({ user_id: userId, encrypted_seed: encryptedSeed, version });
      if (error?.code === "23505") return false;
      if (error) throw new Error(`Auth store error: ${error.message}`);
      return true;
    },

    async listWraps(userId) {
      return check(await supabase.from("vault_wraps").select("*").eq("user_id", userId));
    },
    async getWrap(userId, method, passkeyId) {
      let q = supabase.from("vault_wraps").select("*").eq("user_id", userId).eq("method", method);
      q = passkeyId ? q.eq("passkey_id", passkeyId) : q.is("passkey_id", null);
      return check(await q.maybeSingle());
    },
    async upsertWrap(userId, method, passkeyId, wrappedDek) {
      check(
        await supabase.rpc("upsert_vault_wrap", {
          p_user: userId,
          p_method: method,
          p_passkey: passkeyId ?? null,
          p_wrapped_dek: wrappedDek,
        })
      );
    },
    async deleteWrap(userId, method, passkeyId) {
      let q = supabase.from("vault_wraps").delete().eq("user_id", userId).eq("method", method);
      q = passkeyId ? q.eq("passkey_id", passkeyId) : q.is("passkey_id", null);
      check(await q);
    },

    async getPinGuard(userId) {
      return check(await supabase.from("pin_guard").select("*").eq("user_id", userId).maybeSingle());
    },
    async upsertPinGuard(userId, { salt, params, verifierMac, serverShareEnc }) {
      check(
        await supabase.from("pin_guard").upsert(
          {
            user_id: userId,
            salt,
            params,
            verifier_mac: verifierMac,
            server_share_enc: serverShareEnc,
            failed_attempts: 0,
            lock_count: 0,
            locked_until: null,
            updated_at: nowIso(),
          },
          { onConflict: "user_id" }
        )
      );
    },
    async reservePinAttempt(userId, maxAttempts, baseLockSec) {
      const rows = check(
        await supabase.rpc("reserve_pin_attempt", { p_user: userId, p_max: maxAttempts, p_base_lock_seconds: baseLockSec })
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      return {
        allowed: Boolean(row?.o_allowed),
        attempts: row?.o_attempts ?? 0,
        lockedUntil: row?.o_locked_until ?? null,
      };
    },
    async recordPinFailure(userId, maxAttempts, baseLockSec, maxLockSec) {
      return check(
        await supabase.rpc("record_pin_failure", {
          p_user: userId,
          p_max: maxAttempts,
          p_base_lock_seconds: baseLockSec,
          p_max_lock_seconds: maxLockSec,
        })
      );
    },
    async resetPinAttempts(userId) {
      check(
        await supabase
          .from("pin_guard")
          .update({ failed_attempts: 0, lock_count: 0, locked_until: null, updated_at: nowIso() })
          .eq("user_id", userId)
      );
    },

    async getRecovery(userId) {
      return check(await supabase.from("recovery_codes").select("*").eq("user_id", userId).maybeSingle());
    },
    async setRecovery(userId, codeMac) {
      check(
        await supabase
          .from("recovery_codes")
          .upsert({ user_id: userId, code_mac: codeMac, created_at: nowIso(), used_at: null }, { onConflict: "user_id" })
      );
    },

    async insertSession(s) {
      check(
        await supabase.from("auth_sessions").insert({
          id: s.id,
          user_id: s.userId,
          family_id: s.familyId,
          token_hash: s.tokenHash,
          amr: s.amr,
          auth_time: s.authTime,
          passkey_id: s.passkeyId,
          user_agent: s.userAgent,
          expires_at: s.expiresAt,
        })
      );
    },
    async consumeSession(tokenHash, now) {
      // UPDATE ... WHERE consumed_at IS NULL ... RETURNING: one winner per refresh token.
      return check(
        await supabase
          .from("auth_sessions")
          .update({ consumed_at: now })
          .eq("token_hash", tokenHash)
          .is("consumed_at", null)
          .is("revoked_at", null)
          .gt("expires_at", now)
          .select("*")
          .maybeSingle()
      );
    },
    async findSessionByHash(tokenHash) {
      return check(await supabase.from("auth_sessions").select("*").eq("token_hash", tokenHash).maybeSingle());
    },
    async revokeSessionFamily(familyId) {
      check(await supabase.from("auth_sessions").update({ revoked_at: nowIso() }).eq("family_id", familyId).is("revoked_at", null));
    },
    async revokeSessionsForPasskey(passkeyId) {
      check(await supabase.from("auth_sessions").update({ revoked_at: nowIso() }).eq("passkey_id", passkeyId).is("revoked_at", null));
    },
  };
}
