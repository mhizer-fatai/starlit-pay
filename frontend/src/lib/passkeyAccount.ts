// Passkey account actions used by the sign-in page and Settings. Wires the
// vault flows to the profile API and the in-memory session in lib/auth.

import { BackendError, register } from "@/lib/backend";
import { identityCommitment } from "@/lib/keys";
import { unlockFromVault } from "@/lib/auth";
import { createVault, VaultError, type NewVault } from "@/lib/vault";
import { AuthApiError } from "@/lib/vault/api";
import { authApi, getEmailProof, passkeyFlows } from "@/lib/vault/client";
import { NoVaultError, PasskeyNeedsPinError } from "@/lib/vault/flows";
import { PasskeyCancelledError, PasskeyUnsupportedError } from "@/lib/vault/webauthn";

export { passkeysSupported } from "@/lib/vault/webauthn";

/** A readable name for this device, shown in the passkey list. */
export function guessDeviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android device";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux PC";
  return "This device";
}

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
    });
    pendingSignup = { email, vault };
  }

  status("Confirm with your fingerprint, face or screen lock…");
  const result = await passkeyFlows.signUp({ emailProof, pin: input.pin, deviceName: guessDeviceName(), vault });
  pendingSignup = null;
  unlockFromVault(result.vault, result.user);
  return { recoveryCode: result.recoveryCode, passkeyCanUnlock: result.passkeyCanUnlock };
}

export async function signInWithPasskey(): Promise<void> {
  const { vault, user } = await passkeyFlows.unlockWithPasskey();
  unlockFromVault(vault, user);
}

/** PIN unlock for passkey accounts: uses the current session, or Google proof when there is none. */
export async function unlockWithVaultPin(pin: string, { useEmailProof }: { useEmailProof: boolean }): Promise<void> {
  const proof = useEmailProof ? await requireEmailProof() : null;
  const { vault, user } = await passkeyFlows.unlockWithPin(pin, proof);
  unlockFromVault(vault, user);
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
  if (err instanceof VaultError) return "Your wallet couldn't be unlocked on this device. Try your PIN instead.";
  if (err instanceof AuthApiError) {
    if (err.code === "pin_incorrect") {
      const left = err.attemptsRemaining;
      return left === null ? "Incorrect PIN." : `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`;
    }
    if (err.code === "pin_locked" && err.retryAfterSec) {
      const minutes = Math.ceil(err.retryAfterSec / 60);
      return `Too many incorrect PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return err.message;
  }
  if (err instanceof BackendError) return err.message;
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}
