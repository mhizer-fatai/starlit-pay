import crypto from "node:crypto";

// In-memory store with the same semantics as the Supabase store, including the
// atomic operations (challenge consumption, refresh rotation, PIN reservation).
// Used by the tests; never use it in production.
export function createMemoryStore({ now = () => Date.now(), users = [] } = {}) {
  const db = {
    users: new Map(users.map((u) => [u.id, { ...u }])),
    challenges: new Map(),
    passkeys: new Map(),
    vaults: new Map(),
    wraps: [],
    pinGuards: new Map(),
    recovery: new Map(),
    sessions: new Map(),
  };
  const iso = () => new Date(now()).toISOString();
  const copy = (row) => (row ? structuredClone(row) : null);

  return {
    db,

    async findUserByEmail(email) {
      return copy([...db.users.values()].find((u) => u.email === email.toLowerCase()));
    },
    async findUserById(id) {
      return copy(db.users.get(id));
    },

    async createChallenge({ userId, purpose, challenge, expiresAt }) {
      const id = crypto.randomUUID();
      db.challenges.set(id, { id, user_id: userId, purpose, challenge, expires_at: expiresAt, created_at: iso() });
      return id;
    },
    async consumeChallenge(id) {
      const row = db.challenges.get(id);
      db.challenges.delete(id);
      return copy(row);
    },

    async listPasskeys(userId) {
      return [...db.passkeys.values()].filter((p) => p.user_id === userId).map(copy);
    },
    async findPasskeyByCredentialId(credentialId) {
      return copy([...db.passkeys.values()].find((p) => p.credential_id === credentialId));
    },
    async insertPasskey(p) {
      const row = {
        id: crypto.randomUUID(),
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
        revoked_at: null,
        last_used_at: null,
        created_at: iso(),
      };
      db.passkeys.set(row.id, row);
      return copy(row);
    },
    async updatePasskeyUsage(id, { counter, backedUp, lastUsedAt }) {
      const row = db.passkeys.get(id);
      if (row) Object.assign(row, { counter, backed_up: backedUp, last_used_at: lastUsedAt });
    },
    async revokePasskey(id, at) {
      const row = db.passkeys.get(id);
      if (row) row.revoked_at = at;
    },

    async getVault(userId) {
      return copy(db.vaults.get(userId));
    },
    async createVault(userId, { encryptedSeed, version, profileBound = false }) {
      if (db.vaults.has(userId)) return false;
      db.vaults.set(userId, {
        user_id: userId,
        encrypted_seed: encryptedSeed,
        version,
        profile_bound_at: profileBound ? iso() : null,
        created_at: iso(),
        updated_at: iso(),
      });
      return true;
    },
    async bindProfileKeys(userId, { publicEncryptionKey, stellarAddress, identityCommitment }) {
      const vault = db.vaults.get(userId);
      if (!vault || vault.profile_bound_at) return false;
      vault.profile_bound_at = iso();
      Object.assign(db.users.get(userId), {
        public_encryption_key: publicEncryptionKey,
        stellar_address: stellarAddress,
        identity_commitment: identityCommitment,
      });
      return true;
    },

    async listWraps(userId) {
      return db.wraps.filter((w) => w.user_id === userId).map(copy);
    },
    async getWrap(userId, method, passkeyId) {
      return copy(db.wraps.find((w) => w.user_id === userId && w.method === method && w.passkey_id === (passkeyId ?? null)));
    },
    async upsertWrap(userId, method, passkeyId, wrappedDek) {
      const existing = db.wraps.find((w) => w.user_id === userId && w.method === method && w.passkey_id === (passkeyId ?? null));
      if (existing) Object.assign(existing, { wrapped_dek: wrappedDek, updated_at: iso() });
      else db.wraps.push({ id: crypto.randomUUID(), user_id: userId, method, passkey_id: passkeyId ?? null, wrapped_dek: wrappedDek, created_at: iso(), updated_at: iso() });
    },
    async deleteWrap(userId, method, passkeyId) {
      db.wraps = db.wraps.filter((w) => !(w.user_id === userId && w.method === method && w.passkey_id === (passkeyId ?? null)));
    },

    async getPinGuard(userId) {
      return copy(db.pinGuards.get(userId));
    },
    async upsertPinGuard(userId, { salt, params, verifierMac, serverShareEnc }) {
      db.pinGuards.set(userId, {
        user_id: userId,
        salt,
        params,
        verifier_mac: verifierMac,
        server_share_enc: serverShareEnc,
        failed_attempts: 0,
        lock_count: 0,
        locked_until: null,
        updated_at: iso(),
      });
    },
    async reservePinAttempt(userId, maxAttempts, baseLockSec) {
      const g = db.pinGuards.get(userId);
      if (!g) return { allowed: false, attempts: 0, lockedUntil: null };
      if (g.locked_until && new Date(g.locked_until).getTime() > now()) {
        return { allowed: false, attempts: g.failed_attempts, lockedUntil: g.locked_until };
      }
      if (g.locked_until) {
        g.failed_attempts = 0;
        g.locked_until = null;
      }
      if (g.failed_attempts >= maxAttempts) {
        g.locked_until = new Date(now() + baseLockSec * 1000).toISOString();
        return { allowed: false, attempts: g.failed_attempts, lockedUntil: g.locked_until };
      }
      g.failed_attempts += 1;
      return { allowed: true, attempts: g.failed_attempts, lockedUntil: null };
    },
    async recordPinFailure(userId, maxAttempts, baseLockSec, maxLockSec) {
      const g = db.pinGuards.get(userId);
      if (!g || g.failed_attempts < maxAttempts) return null;
      if (g.locked_until && new Date(g.locked_until).getTime() > now()) return g.locked_until;
      const lockSec = Math.min(baseLockSec * 2 ** g.lock_count, maxLockSec);
      g.locked_until = new Date(now() + lockSec * 1000).toISOString();
      g.lock_count += 1;
      return g.locked_until;
    },
    async resetPinAttempts(userId) {
      const g = db.pinGuards.get(userId);
      if (g) Object.assign(g, { failed_attempts: 0, lock_count: 0, locked_until: null });
    },

    async getRecovery(userId) {
      return copy(db.recovery.get(userId));
    },
    async setRecovery(userId, codeMac) {
      db.recovery.set(userId, { user_id: userId, code_mac: codeMac, created_at: iso(), used_at: null });
    },
    async consumeRecoveryCode(userId) {
      const row = db.recovery.get(userId);
      if (!row || row.used_at) return false;
      row.used_at = iso();
      return true;
    },

    async insertSession(s) {
      db.sessions.set(s.tokenHash, {
        id: s.id,
        user_id: s.userId,
        family_id: s.familyId,
        token_hash: s.tokenHash,
        amr: s.amr,
        auth_time: s.authTime,
        passkey_id: s.passkeyId,
        user_agent: s.userAgent,
        expires_at: s.expiresAt,
        consumed_at: null,
        revoked_at: null,
        created_at: iso(),
      });
    },
    async consumeSession(tokenHash, nowIso) {
      const row = db.sessions.get(tokenHash);
      if (!row || row.consumed_at || row.revoked_at || row.expires_at <= nowIso) return null;
      row.consumed_at = nowIso;
      return copy(row);
    },
    async findSessionByHash(tokenHash) {
      return copy(db.sessions.get(tokenHash));
    },
    async revokeSessionFamily(familyId) {
      for (const row of db.sessions.values()) if (row.family_id === familyId && !row.revoked_at) row.revoked_at = iso();
    },
    async revokeSessionsForPasskey(passkeyId) {
      for (const row of db.sessions.values()) if (row.passkey_id === passkeyId && !row.revoked_at) row.revoked_at = iso();
    },

    async purgeExpiredChallenges(nowIso) {
      let removed = 0;
      for (const [id, row] of db.challenges) if (row.expires_at < nowIso) (db.challenges.delete(id), removed++);
      return removed;
    },
    async purgeExpiredSessions(cutoffIso) {
      let removed = 0;
      for (const [hash, row] of db.sessions) if (row.expires_at < cutoffIso) (db.sessions.delete(hash), removed++);
      return removed;
    },
  };
}
