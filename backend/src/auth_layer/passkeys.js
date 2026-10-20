import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { fromB64u, isUuid, toB64u, uuidToBytes } from "./crypto.js";
import { provenEmail, safeUser } from "./identity.js";

// ES256 (secp256r1) first: it is the curve Soroban verifies natively, so the
// same credential type works for the on-chain smart account later. RS256 covers
// Windows Hello authenticators that only offer RSA.
const SUPPORTED_ALGS = [-7, -257];
const CEREMONY_TIMEOUT_MS = 60_000;

export function publicPasskey(passkey, nowMs) {
  return {
    id: passkey.id,
    // Public WebAuthn identifier; lets the app match the passkey that controls the smart wallet.
    credentialId: passkey.credential_id,
    deviceName: passkey.device_name,
    createdAt: passkey.created_at,
    lastUsedAt: passkey.last_used_at,
    backedUp: passkey.backed_up,
    prfEnabled: passkey.prf_enabled,
    pending: Boolean(passkey.pending_until && new Date(passkey.pending_until).getTime() > nowMs),
  };
}

function cleanDeviceName(value) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 64);
  return clean || null;
}

// A passkey added with only a recovery-code sign-in waits this long before it
// works, giving the real owner time to react to the alert email.
const RECOVERY_PASSKEY_DELAY_MS = 24 * 60 * 60 * 1000;

export function registerPasskeyRoutes(router, { store, sessions, identity, settings, alerts }) {
  const nowMs = () => settings.now();
  const expiresAt = () => new Date(nowMs() + settings.challengeTtlMs).toISOString();
  const activePasskeys = async (userId) =>
    (await store.listPasskeys(userId)).filter((p) => !p.revoked_at);

  async function takeChallenge(challengeId, purposes) {
    if (!isUuid(challengeId)) return null;
    const challenge = await store.consumeChallenge(challengeId);
    if (!challenge || !purposes.includes(challenge.purpose)) return null;
    if (new Date(challenge.expires_at).getTime() < nowMs()) return null;
    return challenge;
  }

  // --- Registration -------------------------------------------------------
  // First passkey on an account: requires proof of the email (Google sign-in).
  // Further passkeys: requires a session with a fresh passkey or PIN ceremony.
  router.post("/api/auth/passkey/register/options", async (req, res) => {
    const auth = sessions.authenticate(req);
    if (auth?.error === "csrf") return res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
    const session = auth?.session ?? null;
    const email = await provenEmail(identity, req);

    let user = null;
    if (email) user = await store.findUserByEmail(email);
    else if (session) user = await store.findUserById(session.id);
    if (!user) return res.status(401).json({ error: "Sign in to add a passkey.", code: "no_identity" });
    if (session && session.id !== user.id) {
      return res.status(403).json({ error: "Signed in as a different account.", code: "account_mismatch" });
    }

    const existing = await activePasskeys(user.id);
    if (existing.length === 0) {
      if (!email) return res.status(401).json({ error: "Confirm your email to add a passkey.", code: "email_proof_required" });
    } else if (!session || !sessions.isFresh(session)) {
      return res.status(401).json({ error: "Please confirm it's you with your passkey or PIN.", code: "reauth_required" });
    }

    const options = await generateRegistrationOptions({
      rpName: settings.rpName,
      rpID: settings.rpID,
      userName: user.username || user.email,
      userDisplayName: user.display_name || user.username || user.email,
      userID: uuidToBytes(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: p.transports?.length ? p.transports : undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      // es256Only: a passkey that must also control an on-chain smart wallet
      // (Stellar verifies secp256r1 / ES256 only, not RSA).
      supportedAlgorithmIDs: req.body?.es256Only === true ? [-7] : SUPPORTED_ALGS,
      timeout: CEREMONY_TIMEOUT_MS,
    });

    const challengeId = await store.createChallenge({
      userId: user.id,
      purpose: "register",
      challenge: options.challenge,
      expiresAt: expiresAt(),
    });
    res.json({ challengeId, options });
  });

  router.post("/api/auth/passkey/register/verify", async (req, res) => {
    const { challengeId, response, deviceName, prfEnabled } = req.body ?? {};
    if (!response || typeof response !== "object") return res.status(400).json({ error: "Missing passkey response." });

    const challenge = await takeChallenge(challengeId, ["register"]);
    if (!challenge) return res.status(400).json({ error: "This request expired. Please try again.", code: "challenge_invalid" });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: settings.origins,
        expectedRPID: settings.rpID,
        requireUserVerification: true,
        supportedAlgorithmIDs: SUPPORTED_ALGS,
      });
    } catch {
      return res.status(400).json({ error: "Passkey could not be verified.", code: "verification_failed" });
    }
    if (!verification.verified) return res.status(400).json({ error: "Passkey could not be verified.", code: "verification_failed" });

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    if (await store.findPasskeyByCredentialId(credential.id)) {
      return res.status(409).json({ error: "This passkey is already registered.", code: "duplicate_passkey" });
    }

    const user = await store.findUserById(challenge.user_id);
    if (!user) return res.status(400).json({ error: "Account not found.", code: "challenge_invalid" });

    const current = sessions.authenticate(req)?.session;
    const recoveryOnly =
      current?.id === user.id && current.amr.includes("recovery") && !current.amr.some((m) => m === "passkey" || m === "pin");

    const passkey = await store.insertPasskey({
      userId: user.id,
      credentialId: credential.id,
      publicKey: toB64u(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      prfEnabled: prfEnabled === true,
      deviceName: cleanDeviceName(deviceName),
      pendingUntil: recoveryOnly ? new Date(nowMs() + RECOVERY_PASSKEY_DELAY_MS).toISOString() : null,
    });
    void alerts.send(user, "passkey_added", { deviceName: passkey.device_name, pending: recoveryOnly });

    // Enrolling the first passkey (via email proof) also signs the user in.
    const auth = sessions.authenticate(req);
    if (!auth?.session || auth.session.id !== user.id) {
      await sessions.issue(res, user, { amr: ["passkey"], passkeyId: passkey.id, userAgent: req.headers["user-agent"] });
    }

    res.status(201).json({ passkey: publicPasskey(passkey, nowMs()), user: safeUser(user) });
  });

  // --- Authentication -----------------------------------------------------
  // purpose "login": usernameless (discoverable credential), no session needed.
  // purpose "stepup": re-confirms the signed-in user before a sensitive action.
  router.post("/api/auth/passkey/login/options", async (req, res) => {
    const purpose = req.body?.purpose === "stepup" ? "stepup" : "login";
    let userId = null;
    let allowCredentials;

    if (purpose === "stepup") {
      const auth = sessions.authenticate(req);
      if (auth?.error === "csrf") return res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
      if (!auth?.session) return res.status(401).json({ error: "Not signed in.", code: "no_session" });
      userId = auth.session.id;
      allowCredentials = (await activePasskeys(userId)).map((p) => ({
        id: p.credential_id,
        transports: p.transports?.length ? p.transports : undefined,
      }));
      if (allowCredentials.length === 0) {
        return res.status(400).json({ error: "No passkey on this account.", code: "no_passkey" });
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: settings.rpID,
      userVerification: "required",
      allowCredentials,
      timeout: CEREMONY_TIMEOUT_MS,
    });
    const challengeId = await store.createChallenge({ userId, purpose, challenge: options.challenge, expiresAt: expiresAt() });
    res.json({ challengeId, options });
  });

  router.post("/api/auth/passkey/login/verify", async (req, res) => {
    const { challengeId, response } = req.body ?? {};
    const failed = () => res.status(401).json({ error: "Passkey sign-in failed.", code: "verification_failed" });
    if (!response || typeof response.id !== "string") return failed();

    const challenge = await takeChallenge(challengeId, ["login", "stepup"]);
    if (!challenge) return res.status(400).json({ error: "This request expired. Please try again.", code: "challenge_invalid" });

    const passkey = await store.findPasskeyByCredentialId(response.id);
    if (!passkey || passkey.revoked_at) return failed();
    if (passkey.pending_until && new Date(passkey.pending_until).getTime() > nowMs()) {
      return res.status(403).json({ error: "This passkey is still in its safety waiting period.", code: "passkey_pending" });
    }

    let stepupSession = null;
    if (challenge.purpose === "stepup") {
      const auth = sessions.authenticate(req);
      if (auth?.error === "csrf") return res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
      stepupSession = auth?.session ?? null;
      if (!stepupSession || stepupSession.id !== challenge.user_id || passkey.user_id !== challenge.user_id) return failed();
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: settings.origins,
        expectedRPID: settings.rpID,
        credential: {
          id: passkey.credential_id,
          publicKey: fromB64u(passkey.public_key),
          counter: Number(passkey.counter),
          transports: passkey.transports ?? undefined,
        },
        requireUserVerification: true,
      });
    } catch {
      return failed();
    }
    if (!verification.verified) return failed();

    await store.updatePasskeyUsage(passkey.id, {
      counter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date(nowMs()).toISOString(),
    });

    const user = await store.findUserById(passkey.user_id);
    if (!user) return failed();

    if (stepupSession) {
      sessions.markFresh(res, user, stepupSession, "passkey");
      return res.json({ ok: true });
    }

    await sessions.issue(res, user, { amr: ["passkey"], passkeyId: passkey.id, userAgent: req.headers["user-agent"] });

    // The passkey's wrapped vault key is released only after this ceremony.
    const vault = await store.getVault(user.id);
    const wrap = vault ? await store.getWrap(user.id, "passkey", passkey.id) : null;
    res.json({
      user: safeUser(user),
      passkeyId: passkey.id,
      vault: vault ? { encryptedSeed: vault.encrypted_seed, version: vault.version } : null,
      wrappedDek: wrap?.wrapped_dek ?? null,
    });
  });

  // --- Management ---------------------------------------------------------
  router.get("/api/auth/passkeys", sessions.requireSession, async (req, res) => {
    const passkeys = await store.listPasskeys(req.session.id);
    res.json({ passkeys: passkeys.filter((p) => !p.revoked_at).map((p) => publicPasskey(p, nowMs())) });
  });

  router.patch("/api/auth/passkeys/:id", sessions.requireSession, async (req, res) => {
    const deviceName = cleanDeviceName(req.body?.deviceName);
    if (!deviceName) return res.status(400).json({ error: "Enter a name for this passkey." });
    const target = (await activePasskeys(req.session.id)).find((p) => p.id === req.params.id);
    if (!target) return res.status(404).json({ error: "Passkey not found." });
    await store.renamePasskey(target.id, deviceName);
    res.json({ passkey: publicPasskey({ ...target, device_name: deviceName }, nowMs()) });
  });

  router.delete("/api/auth/passkeys/:id", sessions.requireSession, sessions.requireFreshAuth, async (req, res) => {
    const userId = req.session.id;
    const passkeys = await activePasskeys(userId);
    const target = passkeys.find((p) => p.id === req.params.id);
    if (!target) return res.status(404).json({ error: "Passkey not found." });

    // Never remove the last way to unlock the vault.
    const others = passkeys.filter((p) => p.id !== target.id);
    const pinGuard = await store.getPinGuard(userId);
    if (others.length === 0 && !pinGuard) {
      return res.status(409).json({ error: "Add another passkey or set a PIN before removing your last passkey.", code: "last_unlock_method" });
    }

    await store.revokePasskey(target.id, new Date(nowMs()).toISOString());
    await store.deleteWrap(userId, "passkey", target.id);
    await store.revokeSessionsForPasskey(target.id);
    res.json({ ok: true });
  });
}
