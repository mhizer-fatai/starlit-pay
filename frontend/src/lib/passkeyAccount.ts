// Passkey account actions used by the sign-in page and Settings. Wires the
// vault flows to the profile API and the in-memory session in lib/auth.

import { BackendError, register } from "@/lib/backend";
import { identityCommitment } from "@/lib/keys";
import { unlockFromVault, type SessionUser } from "@/lib/auth";
import { needsMigrationFinish } from "@/lib/migration";
import { closeVault, createVault, VaultError, type NewVault, type OpenedVault } from "@/lib/vault";
import { AuthApiError } from "@/lib/vault/api";
import { authApi, getEmailProof, passkeyFlows } from "@/lib/vault/client";
import { NoVaultError, PasskeyNeedsPinError } from "@/lib/vault/flows";
import { guessDeviceName, PasskeyCancelledError, PasskeyUnsupportedError } from "@/lib/vault/webauthn";

export { guessDeviceName, passkeysSupported } from "@/lib/vault/webauthn";

async function requireEmailProof(): Promise<string> {
  const proof = await getEmailProof();
  if (!proof) throw new Error("Your Google sign-in expired. Please continue with Google again.");
  return proof;
}

// If the passkey prompt is cancelled after the profile was registered, a retry
// must reuse the same wallet keys: the profile already holds their public keys.
let pendingSignup: { email: string; vault: NewVault } | null = null;

export async function createPasskeyAccount(input: {
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  pin: string;
  onStatus?: (message: string) => void;
}): Promise<{ recoveryCode: string; passkeyCanUnlock: boolean }> {
  const status = input.onStatus ?? (() => undefined);
  const email = input.email.toLowerCase().trim();
  const emailProof = await requireEmailProof();

  let vault = pendingSignup?.email === email ? pendingSignup.vault : null;
  if (!vault) {
    status("Creating your wallet…");
    vault = await createVault();
    status("Creating your account…");
    // The legacy JWT this returns is ignored: passkey accounts use cookie sessions.
    await register({
      email,
      username: input.username,
      display_name: input.displayName || input.username,
      identity_commitment: await identityCommitment(vault.keys.spendingKey),
      public_encryption_key: vault.keys.viewing.publicKey,
      avatar_url: input.avatarUrl,
      stellar_address: vault.keys.stellar.publicKey,
    }, emailProof);
    pendingSignup = { email, vault };
  }

  status("Confirm with your fingerprint, face or screen lock…");
  const result = await passkeyFlows.signUp({ emailProof, pin: input.pin, deviceName: guessDeviceName(), vault, profileBound: true });
  pendingSignup = null;
  unlockFromVault(result.vault, result.user);
  return { recoveryCode: result.recoveryCode, passkeyCanUnlock: result.passkeyCanUnlock };
}

/**
 * The result of unlocking. When an upgrade from the older email+PIN keys did
 * not finish, the vault is NOT signed in yet: the caller must finish the
 * upgrade (see lib/migration) with the returned vault.
 */
export type UnlockOutcome = { status: "unlocked" } | { status: "finish-upgrade"; user: SessionUser; opened: OpenedVault };

function settle(opened: OpenedVault, user: SessionUser): UnlockOutcome {
  if (needsMigrationFinish(user, opened)) return { status: "finish-upgrade", user, opened };
  unlockFromVault(opened, user);
  return { status: "unlocked" };
}

export async function signInWithPasskey(): Promise<UnlockOutcome> {
  const { vault, user } = await passkeyFlows.unlockWithPasskey();
  return settle(vault, user as SessionUser);
}

/** PIN unlock for passkey accounts: uses the current session, or Google proof when there is none. */
export async function unlockWithVaultPin(pin: string, { useEmailProof }: { useEmailProof: boolean }): Promise<UnlockOutcome> {
  const proof = useEmailProof ? await requireEmailProof() : null;
  const { vault, user } = await passkeyFlows.unlockWithPin(pin, proof);
  return settle(vault, user as SessionUser);
}

/** Recovery code unlock (needs Google). Returns the replacement code to show once. */
export async function unlockWithRecovery(code: string): Promise<{ outcome: UnlockOutcome; newRecoveryCode: string; opened: OpenedVault }> {
  const { vault, user, newRecoveryCode } = await passkeyFlows.unlockWithRecoveryCode(code, await requireEmailProof());
  return { outcome: settle(vault, user as SessionUser), newRecoveryCode, opened: vault };
}

/**
 * One confirmation per private payment: a passkey ceremony (Face ID, Touch ID,
 * Windows Hello) verified by the backend. Proves the account owner is present,
 * so an unlocked device or a rogue script cannot send on its own.
 */
export async function confirmPaymentWithPasskey(): Promise<void> {
  await passkeyFlows.stepUp();
}

/** PIN fallback for the payment confirmation (same per-account attempt limits as unlock). */
export async function confirmPaymentWithPin(pin: string): Promise<void> {
  const { vault } = await passkeyFlows.unlockWithPin(pin, null);
  // Only the check matters here; the wallet is already open.
  closeVault(vault.secrets);
}

/**
 * After Google sign-in: does this existing account use the passkey vault (a
 * PIN is stored server-side) or the older email+PIN keys?
 */
export async function accountUsesVault(): Promise<boolean> {
  try {
    await authApi.pinSalt(await requireEmailProof());
    return true;
  } catch (err) {
    if (err instanceof AuthApiError && err.code === "no_pin") return false;
    throw err;
  }
}

/** Whether a passkey session cookie is still valid (refreshing it if needed). */
export async function hasPasskeySession(): Promise<boolean> {
  try {
    await authApi.getSession();
    return true;
  } catch {
    return false;
  }
}

export function friendlyAuthError(err: unknown): string {
  if (err instanceof PasskeyCancelledError) return "The passkey request was cancelled. Try again when you're ready.";
  if (err instanceof PasskeyUnsupportedError) return "This browser doesn't support passkeys. Try a recent Chrome, Safari, Edge or Firefox.";
  if (err instanceof PasskeyNeedsPinError) return err.message;
  if (err instanceof NoVaultError) return "Your account setup wasn't finished. Please contact support@starlitpay.xyz.";
  if (err instanceof VaultError) return err.message.startsWith("That doesn't look like") ? err.message : "Your wallet couldn't be unlocked on this device. Try your PIN instead.";
  if (err instanceof AuthApiError) {
    if (err.code === "pin_incorrect") {
      const left = err.attemptsRemaining;
      return left === null ? "Incorrect PIN." : `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`;
    }
    if (err.code === "recovery_invalid") return "That recovery code isn't valid for this account. It may already have been used.";
    if (err.code === "pin_locked" && err.retryAfterSec) {
      const minutes = Math.ceil(err.retryAfterSec / 60);
      return `Too many incorrect PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return err.message;
  }
  if (err instanceof BackendError) return err.message;
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}
