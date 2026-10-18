// End-to-end: the real frontend flows against the real backend auth layer
// (in-memory store), with a simulated browser built on the backend's software
// WebAuthn authenticator. Requires backend dependencies (npm install in backend/).

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// @ts-expect-error untyped backend test helper
import { startHarness } from "../../../../backend/test/helpers/harness.js";
// @ts-expect-error untyped backend test helper
import { createSoftAuthenticator } from "../../../../backend/test/helpers/soft_authenticator.js";

import { AuthApiError, createAuthApi, type CreationOptionsJSON, type RequestOptionsJSON } from "./api";
import { fromB64u, PRF_SALT, toB64u } from "./crypto";
import { NoVaultError, PasskeyNeedsPinError, createPasskeyFlows } from "./flows";
import { assertionToJSON, registrationToJSON, type Ceremonies } from "./webauthn";

const EMAIL_PROOF = "google-token-alice";
const PIN = "482913";

type PrfMode = "at-create" | "at-get-only" | "none";

/**
 * A simulated device: one passkey, a cookie jar, and a record of every request
 * body sent, so the test can prove the PRF secret never left the device.
 */
function createDevice(base: string, { prfMode = "at-create" as PrfMode, authenticator = createSoftAuthenticator() } = {}) {
  const prfSecret = createHmac("sha256", "device-secret").update(authenticator.credentialId).digest();
  const prfFor = () => new Uint8Array(createHmac("sha256", prfSecret).update(PRF_SALT).digest());
  const sentBodies: string[] = [];
  const jar = new Map<string, string>();

  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    if (typeof init.body === "string") sentBodies.push(init.body);
    const res = await fetch(url, { ...init, headers });
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";").map((p) => p.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      const expired = attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)).getTime() < Date.now());
      if (!value || expired) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }) as unknown as typeof fetch;

  // Turn the software authenticator's JSON into browser-shaped credentials, so
  // the real registrationToJSON / assertionToJSON (and PRF stripping) run.
  const asBrowserCredential = (json: { id: string; rawId: string; response: Record<string, unknown> }, prf: Uint8Array | null, kind: "create" | "get") => {
    const toBuf = (v: unknown) => {
      const b = fromB64u(v as string);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    const r = json.response;
    const response =
      kind === "create"
        ? { clientDataJSON: toBuf(r.clientDataJSON), attestationObject: toBuf(r.attestationObject), getTransports: () => ["internal"] }
        : {
            clientDataJSON: toBuf(r.clientDataJSON),
            authenticatorData: toBuf(r.authenticatorData),
            signature: toBuf(r.signature),
            userHandle: r.userHandle ? toBuf(r.userHandle) : null,
          };
    const ext =
      prfMode === "none" ? {} : prf ? { prf: { enabled: true, results: { first: prf.buffer.slice(0) } } } : { prf: { enabled: true } };
    return {
      id: json.id,
      rawId: toBuf(json.rawId),
      type: "public-key",
      authenticatorAttachment: "platform",
      response,
      getClientExtensionResults: () => ext,
    } as unknown as PublicKeyCredential;
  };

  const ceremonies: Ceremonies = {
    async create(options: CreationOptionsJSON, wantPrf) {
      const json = authenticator.register(options);
      const prf = wantPrf && prfMode === "at-create" ? prfFor() : null;
      return registrationToJSON(asBrowserCredential(json, prf, "create"));
    },
    async get(options: RequestOptionsJSON, wantPrf) {
      const json = authenticator.assert(options);
      const prf = wantPrf && prfMode !== "none" ? prfFor() : null;
      return assertionToJSON(asBrowserCredential(json, prf, "get"));
    },
  };

  const api = createAuthApi({ baseUrl: base, fetchImpl });
  return { api, flows: createPasskeyFlows({ api, ceremonies }), authenticator, sentBodies, prfB64u: toB64u(prfFor()) };
}

let h: Awaited<ReturnType<typeof startHarness>>;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

describe("passkey flows against the real backend", () => {
  test("sign-up creates a wallet that the same passkey reopens on another device", async () => {
    const phone = createDevice(h.base);
    const signup = await phone.flows.signUp({ emailProof: EMAIL_PROOF, pin: PIN, deviceName: "Phone" });
    expect(signup.passkeyCanUnlock).toBe(true);
    expect(signup.recoveryCode).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);

    const status = await phone.api.getVaultStatus();
    expect(status).toMatchObject({ exists: true, pin: { configured: true }, recovery: { configured: true } });
    expect(status.passkeyWraps).toHaveLength(1);

    // Synced passkey on a second device (same credential, same PRF).
    const laptop = createDevice(h.base, { authenticator: phone.authenticator });
    const unlocked = await laptop.flows.unlockWithPasskey();
    expect(unlocked.vault.keys).toEqual(signup.vault.keys);

    for (const device of [phone, laptop]) {
      expect(device.sentBodies.join("\n")).not.toContain(device.prfB64u);
      expect(device.sentBodies.join("\n")).not.toContain('"prf"');
    }
  }, 60_000);

  test("authenticators that only give PRF on use are handled at sign-up", async () => {
    const device = createDevice(h.base, { prfMode: "at-get-only" });
    const signup = await device.flows.signUp({ emailProof: EMAIL_PROOF, pin: PIN });
    expect(signup.passkeyCanUnlock).toBe(true);
    const again = await createDevice(h.base, { prfMode: "at-get-only", authenticator: device.authenticator }).flows.unlockWithPasskey();
    expect(again.vault.keys.stellar.publicKey).toBe(signup.vault.keys.stellar.publicKey);
  }, 60_000);

  test("a device without PRF signs in, then unlocks with the PIN without Google", async () => {
    const device = createDevice(h.base, { prfMode: "none" });
    const signup = await device.flows.signUp({ emailProof: EMAIL_PROOF, pin: PIN });
    expect(signup.passkeyCanUnlock).toBe(false);

    const other = createDevice(h.base, { prfMode: "none", authenticator: device.authenticator });
    const err = await other.flows.unlockWithPasskey().catch((e) => e);
    expect(err).toBeInstanceOf(PasskeyNeedsPinError);

    const viaPin = await other.flows.unlockWithPin(PIN); // session from the passkey sign-in
    expect(viaPin.vault.keys).toEqual(signup.vault.keys);
  }, 60_000);

  test("a new device unlocks with Google proof plus the PIN", async () => {
    const signup = await createDevice(h.base).flows.signUp({ emailProof: EMAIL_PROOF, pin: PIN });
    const fresh = createDevice(h.base);
    const viaPin = await fresh.flows.unlockWithPin(PIN, EMAIL_PROOF);
    expect(viaPin.vault.keys).toEqual(signup.vault.keys);
    expect((await fresh.api.getSession()).amr).toEqual(["pin"]);
  }, 60_000);

  test("a wrong PIN reports attempts remaining and never opens the vault", async () => {
    await createDevice(h.base).flows.signUp({ emailProof: EMAIL_PROOF, pin: PIN });
    const err = await createDevice(h.base).flows.unlockWithPin("000000", EMAIL_PROOF).catch((e) => e);
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err).toMatchObject({ status: 401, code: "pin_incorrect", attemptsRemaining: 4 });
  }, 60_000);

  test("adding a second passkey lets it unlock the same wallet", async () => {
    const phone = createDevice(h.base);
    const signup = await phone.flows.signUp({ emailProof: EMAIL_PROOF, pin: PIN });

    // Second device signs in with the PIN, re-confirms with a fresh ceremony, adds its own passkey.
    const laptop = createDevice(h.base);
    const opened = await laptop.flows.unlockWithPin(PIN, EMAIL_PROOF);
    const added = await laptop.flows.addPasskey(opened.vault.secrets, "Laptop");
    expect(added.canUnlock).toBe(true);

    const later = createDevice(h.base, { authenticator: laptop.authenticator });
    expect((await later.flows.unlockWithPasskey()).vault.keys).toEqual(signup.vault.keys);
    expect((await phone.api.listPasskeys()).passkeys).toHaveLength(2);
  }, 60_000);

  test("signing in to an account without a vault says so", async () => {
    const device = createDevice(h.base);
    await device.flows.registerPasskey(EMAIL_PROOF);
    const err = await createDevice(h.base, { authenticator: device.authenticator }).flows.unlockWithPasskey().catch((e) => e);
    expect(err).toBeInstanceOf(NoVaultError);
  }, 60_000);

  test("expired sessions refresh transparently", async () => {
    const device = createDevice(h.base);
    await device.flows.signUp({ emailProof: EMAIL_PROOF, pin: PIN });
    h.advance(16 * 60 * 1000); // access token expired, refresh token still valid
    const status = await device.api.getVaultStatus();
    expect(status.exists).toBe(true);
  }, 60_000);
});
