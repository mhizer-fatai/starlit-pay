import crypto from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { isB64uOfLength, isB64uWithin, isUuid, mac, open, safeEqual, seal, toB64u } from "./crypto.js";
import { provenEmail, safeUser } from "./identity.js";

// The vault holds the user's random master seed encrypted under a data key
// (DEK). The DEK is wrapped separately by each unlock method (passkey PRF, PIN,
// recovery code). All wrapping happens in the browser; the server stores the
// results and decides when they may be released.

const WRAPPED_DEK = { min: 40, max: 512 };
const ENCRYPTED_SEED = { min: 40, max: 2048 };
const VERIFIER_BYTES = 32;

const HEX_32 = /^[0-9a-f]{64}$/;

export function registerVaultRoutes(router, { store, sessions, identity, settings, alerts }) {
  const { keys } = settings;
  const nowMs = () => settings.now();
  const { requireSession, requireFreshAuth } = sessions;
  const argon2 = settings.pin.argon2;

  router.get("/api/vault", requireSession, async (req, res) => {
    const userId = req.session.id;
    const [vault, wraps, pinGuard, recovery] = await Promise.all([
      store.getVault(userId),
      store.listWraps(userId),
      store.getPinGuard(userId),
      store.getRecovery(userId),
    ]);
    res.json({
      exists: Boolean(vault),
      version: vault?.version ?? null,
      passkeyWraps: wraps.filter((w) => w.method === "passkey").map((w) => w.passkey_id),
      pin: {
        configured: Boolean(pinGuard),
        locked: Boolean(pinGuard?.locked_until && new Date(pinGuard.locked_until).getTime() > nowMs()),
      },
      recovery: { configured: Boolean(recovery && !recovery.used_at) },
    });
  });

  router.post("/api/vault", requireSession, requireFreshAuth, async (req, res) => {
    // profileBound: a new sign-up whose profile was registered with this vault's
    // keys. Migrating accounts leave it false and bind once their funds moved.
    const { encryptedSeed, version = 1, passkeyWrap, profileBound = false } = req.body ?? {};
    if (!isB64uWithin(encryptedSeed, ENCRYPTED_SEED.min, ENCRYPTED_SEED.max) || version !== 1) {
      return res.status(400).json({ error: "Invalid vault payload." });
    }
    const userId = req.session.id;

    if (passkeyWrap !== undefined) {
      const ok = await validPasskeyWrap(userId, passkeyWrap?.passkeyId, passkeyWrap?.wrappedDek);
      if (!ok) return res.status(400).json({ error: "Invalid passkey wrap." });
    }

    const created = await store.createVault(userId, { encryptedSeed, version, profileBound: profileBound === true });
    if (!created) return res.status(409).json({ error: "A vault already exists for this account.", code: "vault_exists" });

    if (passkeyWrap) {
      await store.upsertWrap(userId, "passkey", passkeyWrap.passkeyId, passkeyWrap.wrappedDek);
    }
    res.status(201).json({ ok: true });
  });

  router.put("/api/vault/wraps/passkey/:passkeyId", requireSession, requireFreshAuth, async (req, res) => {
    const userId = req.session.id;
    if (!(await store.getVault(userId))) return res.status(404).json({ error: "No vault yet.", code: "no_vault" });
    const ok = await validPasskeyWrap(userId, req.params.passkeyId, req.body?.wrappedDek);
    if (!ok) return res.status(400).json({ error: "Invalid passkey wrap." });
    await store.upsertWrap(userId, "passkey", req.params.passkeyId, req.body.wrappedDek);
    res.json({ ok: true });
  });

  // Migration from email+PIN keys: after the client moved the funds to the
  // vault's keys, point the profile at them. Allowed exactly once per vault.
  router.post("/api/vault/migrate/profile-keys", requireSession, requireFreshAuth, async (req, res) => {
    const { publicEncryptionKey, stellarAddress, identityCommitment } = req.body ?? {};
    if (
      !HEX_32.test(publicEncryptionKey ?? "") ||
      !HEX_32.test(identityCommitment ?? "") ||
      typeof stellarAddress !== "string" ||
      !StrKey.isValidEd25519PublicKey(stellarAddress)
    ) {
      return res.status(400).json({ error: "Invalid key payload." });
    }
    const userId = req.session.id;
    if (!(await store.getVault(userId))) return res.status(404).json({ error: "No vault yet.", code: "no_vault" });

    const bound = await store.bindProfileKeys(userId, { publicEncryptionKey, stellarAddress, identityCommitment });
    if (!bound) {
      return res.status(409).json({ error: "This account already uses its vault keys.", code: "already_bound" });
    }
    const user = await store.findUserById(userId);
    void alerts.send(user, "keys_migrated");
    res.json({ user: safeUser(user) });
  });

  async function validPasskeyWrap(userId, passkeyId, wrappedDek) {
    if (!isUuid(passkeyId) || !isB64uWithin(wrappedDek, WRAPPED_DEK.min, WRAPPED_DEK.max)) return false;
    const passkey = (await store.listPasskeys(userId)).find((p) => p.id === passkeyId);
    return Boolean(passkey && !passkey.revoked_at);
  }

  // --- PIN -----------------------------------------------------------------
  // The browser stretches the PIN with Argon2id(salt) and splits the result into
  // a verifier (sent here) and a key part (never sent). The vault key for the
  // PIN method is HKDF(keyPart || serverShare). The server releases serverShare
  // only after the verifier matches, with attempts limited per account, so a
  // database leak alone is not enough to brute-force the PIN offline: the
  // verifier is stored as an HMAC under a key that lives outside the database.

  router.post("/api/vault/pin/setup/begin", requireSession, requireFreshAuth, async (req, res) => {
    const userId = req.session.id;
    if (!(await store.getVault(userId))) return res.status(404).json({ error: "Create your vault first.", code: "no_vault" });

    const salt = toB64u(crypto.randomBytes(16));
    const serverShare = toB64u(crypto.randomBytes(32));
    const ticket = seal(
      keys.setupTicket,
      Buffer.from(JSON.stringify({ u: userId, s: salt, k: serverShare, e: nowMs() + settings.pin.setupTicketTtlMs })),
      "pin-setup"
    );
    res.json({ ticket, salt, params: argon2, serverShare });
  });

  router.post("/api/vault/pin/setup/complete", requireSession, requireFreshAuth, async (req, res) => {
    const userId = req.session.id;
    const { ticket, pinVerifier, wrappedDek } = req.body ?? {};
    const opened = typeof ticket === "string" ? open(keys.setupTicket, ticket, "pin-setup") : null;
    let data = null;
    try {
      data = opened ? JSON.parse(opened.toString("utf8")) : null;
    } catch {
      data = null;
    }
    if (!data || data.u !== userId || data.e < nowMs()) {
      return res.status(400).json({ error: "PIN setup expired. Please start again.", code: "ticket_invalid" });
    }
    if (!isB64uOfLength(pinVerifier, VERIFIER_BYTES) || !isB64uWithin(wrappedDek, WRAPPED_DEK.min, WRAPPED_DEK.max)) {
      return res.status(400).json({ error: "Invalid PIN setup payload." });
    }

    await store.upsertPinGuard(userId, {
      salt: data.s,
      params: argon2,
      verifierMac: mac(keys.pinVerifier, userId, pinVerifier),
      serverShareEnc: seal(keys.serverShare, Buffer.from(data.k), `pin-share:${userId}`),
    });
    await store.upsertWrap(userId, "pin", null, wrappedDek);
    res.json({ ok: true });
  });

  // The PIN account is identified by Google email proof, or by an existing
  // session (e.g. signed in with a passkey on a device without PRF support).
  // Per-account attempt limits apply either way.
  async function pinAccount(req, res) {
    const auth = sessions.authenticate(req);
    if (auth?.error === "csrf") {
      res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
      return null;
    }
    const session = auth?.session ?? null;
    const email = await provenEmail(identity, req);
    if (!email && !session) {
      res.status(401).json({ error: "Confirm your email first.", code: "email_proof_required" });
      return null;
    }
    const user = email ? await store.findUserByEmail(email) : await store.findUserById(session.id);
    if (user && session && session.id !== user.id) {
      res.status(403).json({ error: "Signed in as a different account.", code: "account_mismatch" });
      return null;
    }
    return { user, session };
  }

  router.post("/api/vault/pin/salt", async (req, res) => {
    const account = await pinAccount(req, res);
    if (!account) return;
    const { user } = account;
    const guard = user ? await store.getPinGuard(user.id) : null;
    if (!guard) return res.status(404).json({ error: "No PIN is set for this account.", code: "no_pin" });
    res.json({ salt: guard.salt, params: guard.params });
  });

  router.post("/api/vault/pin/unlock", async (req, res) => {
    const { pinVerifier } = req.body ?? {};
    if (!isB64uOfLength(pinVerifier, VERIFIER_BYTES)) return res.status(400).json({ error: "Invalid PIN payload." });
    const account = await pinAccount(req, res);
    if (!account) return;
    const { user, session } = account;
    const guard = user ? await store.getPinGuard(user.id) : null;
    if (!guard) return res.status(404).json({ error: "No PIN is set for this account.", code: "no_pin" });

    const { maxAttempts, baseLockSec, maxLockSec } = settings.pin;
    const reservation = await store.reservePinAttempt(user.id, maxAttempts, baseLockSec);
    if (!reservation.allowed) return lockedResponse(res, reservation.lockedUntil);

    if (!safeEqual(mac(keys.pinVerifier, user.id, pinVerifier), guard.verifier_mac)) {
      const lockedUntil = await store.recordPinFailure(user.id, maxAttempts, baseLockSec, maxLockSec);
      if (lockedUntil) {
        const lockSeconds = Math.round((new Date(lockedUntil).getTime() - nowMs()) / 1000);
        void alerts.send(user, "pin_locked", { lockSeconds });
        return lockedResponse(res, lockedUntil);
      }
      return res.status(401).json({
        error: "Incorrect PIN.",
        code: "pin_incorrect",
        attemptsRemaining: Math.max(0, maxAttempts - reservation.attempts),
      });
    }

    await store.resetPinAttempts(user.id);
    const serverShare = open(keys.serverShare, guard.server_share_enc, `pin-share:${user.id}`);
    if (!serverShare) return res.status(500).json({ error: "PIN data is unreadable on the server." });

    if (session) sessions.markFresh(res, user, session, "pin");
    else await sessions.issue(res, user, { amr: ["pin"], userAgent: req.headers["user-agent"] });
    const vault = await store.getVault(user.id);
    const wrap = await store.getWrap(user.id, "pin", null);
    res.json({
      user: safeUser(user),
      serverShare: serverShare.toString("utf8"),
      vault: vault ? { encryptedSeed: vault.encrypted_seed, version: vault.version } : null,
      wrappedDek: wrap?.wrapped_dek ?? null,
    });
  });

  function lockedResponse(res, lockedUntil) {
    const retryAfterSec = lockedUntil
      ? Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - nowMs()) / 1000))
      : settings.pin.baseLockSec;
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "Too many incorrect PINs. Try again later.", code: "pin_locked", retryAfterSec });
  }

  // --- Recovery code ---------------------------------------------------------
  // Unlock needs Google email proof plus the code. Each code works once; the
  // client sets a new one straight away. The 128-bit code makes guessing
  // hopeless, and the IP rate limit bounds attempts anyway.
  router.post("/api/vault/recovery/unlock", async (req, res) => {
    const email = await provenEmail(identity, req);
    if (!email) return res.status(401).json({ error: "Confirm your email first.", code: "email_proof_required" });
    const { codeVerifier } = req.body ?? {};
    if (!isB64uOfLength(codeVerifier, VERIFIER_BYTES)) return res.status(400).json({ error: "Invalid recovery payload." });

    const failed = () => res.status(401).json({ error: "That recovery code isn't valid for this account.", code: "recovery_invalid" });
    const user = await store.findUserByEmail(email);
    const recovery = user ? await store.getRecovery(user.id) : null;
    if (!recovery || recovery.used_at) return failed();
    if (!safeEqual(mac(keys.recoveryCode, user.id, codeVerifier), recovery.code_mac)) return failed();
    if (!(await store.consumeRecoveryCode(user.id))) return failed();

    await sessions.issue(res, user, { amr: ["recovery"], userAgent: req.headers["user-agent"] });
    void alerts.send(user, "recovery_used");
    const vault = await store.getVault(user.id);
    const wrap = await store.getWrap(user.id, "recovery", null);
    res.json({
      user: safeUser(user),
      vault: vault ? { encryptedSeed: vault.encrypted_seed, version: vault.version } : null,
      wrappedDek: wrap?.wrapped_dek ?? null,
    });
  });

  // Setting a code replaces the previous one.
  router.post("/api/vault/recovery", requireSession, requireFreshAuth, async (req, res) => {
    const userId = req.session.id;
    const { codeVerifier, wrappedDek } = req.body ?? {};
    if (!(await store.getVault(userId))) return res.status(404).json({ error: "Create your vault first.", code: "no_vault" });
    if (!isB64uOfLength(codeVerifier, VERIFIER_BYTES) || !isB64uWithin(wrappedDek, WRAPPED_DEK.min, WRAPPED_DEK.max)) {
      return res.status(400).json({ error: "Invalid recovery payload." });
    }
    await store.setRecovery(userId, mac(keys.recoveryCode, userId, codeVerifier));
    await store.upsertWrap(userId, "recovery", null, wrappedDek);
    res.json({ ok: true });
  });
}
