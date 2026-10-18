import type { DerivedKeys } from "@/lib/keys";
import {
  createVaultSecrets,
  decryptSeed,
  encryptSeed,
  unwrapDek,
  wipe,
  wrapDek,
  type UnlockMethod,
  type VaultSecrets,
} from "./crypto";
import { deriveWalletKeys } from "./walletKeys";

export * from "./crypto";
export * from "./recovery";
export { deriveWalletKeys } from "./walletKeys";

export interface NewVault {
  secrets: VaultSecrets;
  encryptedSeed: string;
  keys: DerivedKeys;
}

/** Creates a fresh wallet: random seed, data key, encrypted seed and derived keys. */
export async function createVault(): Promise<NewVault> {
  const secrets = createVaultSecrets();
  return {
    secrets,
    encryptedSeed: await encryptSeed(secrets),
    keys: await deriveWalletKeys(secrets.seed),
  };
}

export interface OpenedVault {
  /** Kept in memory while unlocked so further unlock methods can be added. */
  secrets: VaultSecrets;
  keys: DerivedKeys;
}

/** Opens a vault with one unlock method's key-encryption key. Throws VaultError if it is wrong. */
export async function openVault(
  encryptedSeed: string,
  wrappedDek: string,
  kek: CryptoKey,
  method: UnlockMethod
): Promise<OpenedVault> {
  const dek = await unwrapDek(wrappedDek, kek, method);
  try {
    const seed = await decryptSeed(encryptedSeed, dek);
    return { secrets: { seed, dek }, keys: await deriveWalletKeys(seed) };
  } catch (err) {
    wipe(dek);
    throw err;
  }
}

/** Adds another unlock method to an open vault. */
export function addUnlockMethod(secrets: VaultSecrets, kek: CryptoKey, method: UnlockMethod): Promise<string> {
  return wrapDek(secrets.dek, kek, method);
}

/** Forgets the vault's secrets (on lock or sign-out). */
export function closeVault(secrets: VaultSecrets | null | undefined) {
  if (secrets) wipe(secrets.seed, secrets.dek);
}
