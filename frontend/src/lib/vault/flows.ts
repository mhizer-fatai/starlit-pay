// Passkey + vault flows used by the screens. Each flow combines the vault
// crypto, the auth API and the WebAuthn ceremonies; nothing here touches the
// DOM, so the flows are tested end to end against the real backend.

import type { AuthApi, AuthUser, PasskeyLoginResult, PublicPasskey } from "./api";
import {
  kekFromPin,
  kekFromPrf,
  stretchPin,
  VaultError,
  wipe,
  type VaultSecrets,
} from "./crypto";
import { addUnlockMethod, createVault, openVault, type NewVault, type OpenedVault } from "./index";
import { generateRecoveryCode, parseRecoveryCode, recoveryMaterial } from "./recovery";
import type { Ceremonies } from "./webauthn";

const onWindows = () => typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

/** Signed in, but this passkey cannot open the vault on this device (no PRF, or no wrap yet). */
export class PasskeyNeedsPinError extends Error {
  constructor(readonly user: AuthUser) {
    super(
      onWindows()
        ? "Windows Hello can sign you in but can't unlock your wallet on this computer. Enter your PIN, or use your phone's passkey."
        : "This passkey can sign you in but can't unlock your wallet on this device. Enter your PIN, or use your phone's passkey."
    );
    this.name = "PasskeyNeedsPinError";
  }
}

export class NoVaultError extends Error {
  constructor(readonly user: AuthUser) {
    super("This account has no wallet vault yet.");
    this.name = "NoVaultError";
  }
}

export interface EnrolledPasskey {
  passkey: PublicPasskey;
  user: AuthUser;
  /** PRF output for this passkey, or null when the device cannot provide one. */
  prfOutput: Uint8Array | null;
}

export interface UnlockResult {
  user: AuthUser;
  vault: OpenedVault;
}

/**
 * Names a new passkey after where it lives. A passkey made on another device
 * (phone over QR, or a security key) must not be named after this browser.
 */
export function passkeyName(response: Record<string, unknown>, thisDevice?: string): string | undefined {
  if (response.authenticatorAttachment !== "cross-platform") return thisDevice;
  const transports = (response.response as { transports?: unknown } | undefined)?.transports;
  return Array.isArray(transports) && transports.includes("hybrid") ? "Phone" : "Security key";
}

export function createPasskeyFlows({ api, ceremonies }: { api: AuthApi; ceremonies: Ceremonies }) {
  /** Re-confirms the signed-in user (fresh auth for sensitive actions). Returns the PRF output if asked for. */
  async function stepUp(wantPrf = false): Promise<{ credentialId: string; prfOutput: Uint8Array | null }> {
    const { challengeId, options } = await api.passkeyLoginOptions("stepup");
    const { response, prfOutput } = await ceremonies.get(options, wantPrf);
    await api.passkeyLoginVerify({ challengeId, response });
    return { credentialId: response.id, prfOutput };
  }

  /**
   * Registers a passkey. Many authenticators only return PRF output when the
   * passkey is used, not when it is created; in that case it is used once
   * straight away to fetch it.
   */
  async function registerPasskey(
    emailProof: string | null,
    deviceName?: string,
    opts: { es256Only?: boolean } = {}
  ): Promise<EnrolledPasskey> {
    const { challengeId, options } = await api.passkeyRegisterOptions(emailProof, opts);
    const created = await ceremonies.create(options, true);
    const { passkey, user } = await api.passkeyRegisterVerify({
      challengeId,
      response: created.response,
      deviceName: passkeyName(created.response, deviceName),
      prfEnabled: created.prfEnabled,
    });

    let prfOutput = created.prfOutput;
    if (!prfOutput && created.prfEnabled) {
      const used = await stepUp(true);
      // Only trust the output if the user picked the passkey just created.
      prfOutput = used.credentialId === created.response.id ? used.prfOutput : null;
    }
    return { passkey, user, prfOutput };
  }

  /**
   * Stores a vault on the server, protected by the passkey when the device
   * supports PRF. Pass a vault created earlier (whose public keys were already
   * registered) or let one be created here.
   */
  async function createWalletVault(
    passkeyId: string,
    prfOutput: Uint8Array | null,
    existing?: NewVault,
    profileBound = false
  ): Promise<NewVault> {
    const vault = existing ?? (await createVault());
    const passkeyWrap = prfOutput
      ? { passkeyId, wrappedDek: await addUnlockMethod(vault.secrets, await kekFromPrf(prfOutput), "passkey") }
      : undefined;
    await api.createVault({ encryptedSeed: vault.encryptedSeed, passkeyWrap, profileBound });
    return vault;
  }

  async function setPin(secrets: VaultSecrets, pin: string): Promise<void> {
    const setup = await api.pinSetupBegin();
    const stretched = await stretchPin(pin, setup.salt, setup.params);
    try {
      const wrappedDek = await addUnlockMethod(secrets, await kekFromPin(stretched.keyPart, setup.serverShare), "pin");
      await api.pinSetupComplete({ ticket: setup.ticket, pinVerifier: stretched.verifier, wrappedDek });
    } finally {
      wipe(stretched.keyPart);
    }
  }

  /** Creates a recovery code; returns it for one-time display. The server keeps only a verifier. */
  async function setRecoveryCode(secrets: VaultSecrets): Promise<string> {
    const code = await generateRecoveryCode();
    try {
      const material = await recoveryMaterial(code.bytes);
      await api.setRecovery({ codeVerifier: material.verifier, wrappedDek: await addUnlockMethod(secrets, material.kek, "recovery") });
      return code.display;
    } finally {
      wipe(code.bytes);
    }
  }

  /**
   * New account: register the first passkey (with Google email proof), create
   * the vault, set the PIN fallback and a recovery code.
   */
  /**
   * profileBound: true for brand-new accounts (the profile was registered with
   * these keys); false when migrating, where the profile is re-pointed after
   * the funds move.
   */
  async function signUp(input: { emailProof: string; pin: string; deviceName?: string; vault?: NewVault; profileBound?: boolean }) {
    const enrolled = await registerPasskey(input.emailProof, input.deviceName);
    const passkeyCanUnlock = enrolled.prfOutput !== null;
    const vault = await createWalletVault(enrolled.passkey.id, enrolled.prfOutput, input.vault, input.profileBound ?? false);
    wipe(enrolled.prfOutput);
    await setPin(vault.secrets, input.pin);
    const recoveryCode = await setRecoveryCode(vault.secrets);
    return {
      user: enrolled.user,
      vault: { secrets: vault.secrets, keys: vault.keys } as OpenedVault,
      recoveryCode,
      passkeyCanUnlock,
    };
  }

  /** Face ID / Touch ID / Windows Hello sign-in that also opens the vault. */
  async function unlockWithPasskey(): Promise<UnlockResult> {
    const { challengeId, options } = await api.passkeyLoginOptions("login");
    const { response, prfOutput } = await ceremonies.get(options, true);
    const result = await api.passkeyLoginVerify<PasskeyLoginResult>({ challengeId, response });
    try {
      if (!result.vault) throw new NoVaultError(result.user);
      if (!prfOutput || !result.wrappedDek) throw new PasskeyNeedsPinError(result.user);
      const vault = await openVault(result.vault.encryptedSeed, result.wrappedDek, await kekFromPrf(prfOutput), "passkey");
      return { user: result.user, vault };
    } finally {
      wipe(prfOutput);
    }
  }

  /**
   * PIN unlock. Identify the account with Google email proof on a new device,
   * or rely on the current session (e.g. after a passkey sign-in without PRF).
   */
  async function unlockWithPin(pin: string, emailProof?: string | null): Promise<UnlockResult> {
    const { salt, params } = await api.pinSalt(emailProof);
    const stretched = await stretchPin(pin, salt, params);
    try {
      const result = await api.pinUnlock(stretched.verifier, emailProof);
      if (!result.vault) throw new NoVaultError(result.user);
      if (!result.wrappedDek) throw new VaultError("No PIN key is stored for this account.");
      const kek = await kekFromPin(stretched.keyPart, result.serverShare);
      return { user: result.user, vault: await openVault(result.vault.encryptedSeed, result.wrappedDek, kek, "pin") };
    } finally {
      wipe(stretched.keyPart);
    }
  }

  /**
   * Adds a passkey for this device to an open vault. Requires a fresh sign-in
   * (the caller should stepUp() first if the session is not fresh).
   * Returns whether the new passkey can unlock the vault by itself.
   */
  async function addPasskey(
    secrets: VaultSecrets,
    deviceName?: string,
    opts: { es256Only?: boolean; emailProof?: string | null } = {}
  ): Promise<{ passkey: PublicPasskey; canUnlock: boolean }> {
    // The first passkey on an account needs the Google sign-in proof.
    const enrolled = await registerPasskey(opts.emailProof ?? null, deviceName, { es256Only: opts.es256Only });
    try {
      if (!enrolled.prfOutput) return { passkey: enrolled.passkey, canUnlock: false };
      const wrappedDek = await addUnlockMethod(secrets, await kekFromPrf(enrolled.prfOutput), "passkey");
      await api.putPasskeyWrap(enrolled.passkey.id, wrappedDek);
      return { passkey: enrolled.passkey, canUnlock: true };
    } finally {
      wipe(enrolled.prfOutput);
    }
  }

  /**
   * Lost every passkey and the PIN: Google proof plus the recovery code opens
   * the vault. The code is then used up, so a new one is set straight away.
   */
  async function unlockWithRecoveryCode(code: string, emailProof: string): Promise<UnlockResult & { newRecoveryCode: string }> {
    const bytes = await parseRecoveryCode(code);
    if (!bytes) throw new VaultError("That doesn't look like a recovery code. Check it and try again.");
    try {
      const material = await recoveryMaterial(bytes);
      const result = await api.recoveryUnlock(material.verifier, emailProof);
      if (!result.vault) throw new NoVaultError(result.user);
      if (!result.wrappedDek) throw new VaultError("No recovery key is stored for this account.");
      const vault = await openVault(result.vault.encryptedSeed, result.wrappedDek, material.kek, "recovery");
      const newRecoveryCode = await setRecoveryCode(vault.secrets);
      return { user: result.user, vault, newRecoveryCode };
    } finally {
      wipe(bytes);
    }
  }

  return {
    stepUp,
    registerPasskey,
    createWalletVault,
    setPin,
    setRecoveryCode,
    signUp,
    unlockWithPasskey,
    unlockWithPin,
    unlockWithRecoveryCode,
    addPasskey,
  };
}

export type PasskeyFlows = ReturnType<typeof createPasskeyFlows>;
