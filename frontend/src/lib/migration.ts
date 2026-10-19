// Upgrades an older email+PIN account to a passkey vault.
//
// The old keys can be recomputed by anyone who knows the email (by trying all
// PINs), so they cannot just be wrapped in the vault. Instead:
//   1. create the vault with new random keys (passkey + PIN + recovery code)
//   2. spend every old private note into a fresh note owned by the new keys
//      (a private send-to-self through the pool; the relayer pays the fees),
//      so the old note secrets become worthless
//   3. point the profile at the new public keys (allowed once by the server)
//   4. move any XLM on the old public Stellar address to the new one
// Every step can be re-run: an interrupted upgrade resumes where it stopped.

import * as StellarSdk from "@stellar/stellar-sdk";

import {
  BackendError,
  clearSession,
  fetchNotes,
  postNote,
  spendNote,
  submitRelayerTransfer,
} from "@/lib/backend";
import { encryptNote } from "@/lib/crypto";
import { bytesToHex, deriveKeysFromEmailAndPin, identityCommitment, type DerivedKeys } from "@/lib/keys";
import { getSpendableNotes, spendRootFor } from "@/lib/notes";
import { horizon, NETWORK_PASSPHRASE, TOKENS } from "@/lib/stellar";
import { calculateCommitment, generateShieldedPaymentProof } from "@/lib/zk";
import { unlockFromVault, type SessionUser } from "@/lib/auth";
import { createVault, type OpenedVault } from "@/lib/vault";
import { AuthApiError } from "@/lib/vault/api";
import { authApi, getEmailProof, passkeyFlows } from "@/lib/vault/client";
import { NoVaultError } from "@/lib/vault/flows";

const ZERO_COMMITMENT = "0".repeat(64);
const ASSETS = ["XLM", "USDC"] as const;
const MAX_SWEEP_PASSES = 3;

export interface MigrationResult {
  /** New recovery code to show once (a resumed upgrade issues a fresh one too). */
  recoveryCode: string | null;
  passkeyCanUnlock: boolean;
  notesMoved: number;
  publicXlm: PublicSweepResult;
}

export type PublicSweepResult =
  | { status: "none" }
  | { status: "moved"; amount: string }
  | { status: "skipped"; reason: string };

type Status = (message: string) => void;

/** Signs a fresh timestamp with the old Stellar key (the legacy note API's proof of ownership). */
function signedTimestamp(keys: DerivedKeys) {
  const timestamp = Date.now().toString();
  const keypair = StellarSdk.Keypair.fromSecret(keys.stellar.secretKey);
  return { timestamp, signature: bytesToHex(keypair.sign(Buffer.from(timestamp))) };
}

async function loadOldNotes(oldKeys: DerivedKeys) {
  const { timestamp, signature } = signedTimestamp(oldKeys);
  const { notes } = await fetchNotes(oldKeys.viewing.publicKey, timestamp, signature);
  return notes;
}

/** Spends old notes (two at a time) into single fresh notes owned by the new keys. */
async function sweepNotes(oldKeys: DerivedKeys, newKeys: DerivedKeys, username: string, status: Status): Promise<number> {
  let moved = 0;
  for (let pass = 0; pass < MAX_SWEEP_PASSES; pass++) {
    const all = await loadOldNotes(oldKeys);
    let movedThisPass = 0;

    for (const asset of ASSETS) {
      const tokenAddress = TOKENS[asset];
      const notes = getSpendableNotes(all, oldKeys.viewing.secretKey, asset);

      while (notes.length > 0) {
        const input1 = notes.shift()!;
        const input2 = notes.shift() ?? null;
        const amount = input1.amount + (input2?.amount ?? 0);
        status(`Moving your ${asset} (${moved + movedThisPass + 1} of ${moved + movedThisPass + 1 + Math.ceil(notes.length / 2)})…`);

        // A single input is padded with a zero-value dummy, as in Send.
        const secret2 = input2?.secret ?? bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        const commitment2 =
          input2?.commitment ?? (await calculateCommitment(0, oldKeys.viewing.publicKey, tokenAddress, secret2));

        const newSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        const newCommitment = await calculateCommitment(amount, newKeys.viewing.publicKey, tokenAddress, newSecret);
        const enc = encryptNote(amount, asset, newSecret, username, newKeys.viewing.publicKey);
        const encHex = enc.ephemeralPublicKey + enc.nonce + enc.ciphertext;

        const zk = await generateShieldedPaymentProof(
          input1.secret,
          input1.commitment,
          secret2,
          commitment2,
          newKeys.stellar.publicKey,
          tokenAddress,
          amount,
          0
        );
        await submitRelayerTransfer({
          proof: zk.proofHex,
          nullifier_1: zk.nullifier1Hex,
          nullifier_2: zk.nullifier2Hex,
          output_commitment_1: newCommitment,
          encrypted_note_1: encHex,
          output_commitment_2: ZERO_COMMITMENT,
          encrypted_note_2: "00",
          root: await spendRootFor(input1),
        });

        // Record the new note before retiring the old ones, so funds are never
        // invisible: at worst an old note shows until the next pass marks it.
        await postNote({ commitment: newCommitment, encrypted_note: encHex, recipient_viewing_key: newKeys.viewing.publicKey });
        for (const spent of [input1, input2]) {
          if (spent) await spendNote({ commitment: spent.commitment, ...signedTimestamp(oldKeys) });
        }
        movedThisPass += 1;
      }
    }

    moved += movedThisPass;
    if (movedThisPass === 0) break;
  }
  return moved;
}

/** Moves XLM from the old public Stellar address to the new one (create + merge). */
async function sweepPublicXlm(oldKeys: DerivedKeys, newKeys: DerivedKeys, status: Status): Promise<PublicSweepResult> {
  let account: StellarSdk.Horizon.AccountResponse;
  try {
    account = await horizon.loadAccount(oldKeys.stellar.publicKey);
  } catch {
    return { status: "none" };
  }
  if (account.subentry_count > 0) {
    return { status: "skipped", reason: "Your old address has trustlines or offers. Withdraw those funds manually." };
  }
  const xlm = account.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
  if (Number(xlm) < 1.01) return { status: "skipped", reason: "Your old address holds too little XLM to move." };

  let newExists = true;
  try {
    await horizon.loadAccount(newKeys.stellar.publicKey);
  } catch {
    newExists = false;
  }

  status("Moving XLM from your old address…");
  const builder = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE });
  if (!newExists) {
    builder.addOperation(StellarSdk.Operation.createAccount({ destination: newKeys.stellar.publicKey, startingBalance: "1" }));
  }
  builder.addOperation(StellarSdk.Operation.accountMerge({ destination: newKeys.stellar.publicKey }));
  const tx = builder.setTimeout(180).build();
  tx.sign(StellarSdk.Keypair.fromSecret(oldKeys.stellar.secretKey));
  await horizon.submitTransaction(tx);
  return { status: "moved", amount: xlm };
}

async function ensureFreshSession() {
  const session = await authApi.getSession();
  if (!session.fresh) await passkeyFlows.stepUp();
}

/**
 * Opens (or creates) the vault for an account being upgraded. Uses the same
 * PIN as the old account, so one PIN entry covers both.
 */
async function openOrCreateVault(pin: string, emailProof: string, status: Status) {
  let usesVault = true;
  try {
    await authApi.pinSalt(emailProof);
  } catch (err) {
    if (!(err instanceof AuthApiError && err.code === "no_pin")) throw err;
    usesVault = false;
  }

  if (usesVault) {
    status("Unlocking your new vault…");
    const { vault } = await passkeyFlows.unlockWithPin(pin, emailProof);
    return { opened: vault, recoveryCode: null as string | null, passkeyCanUnlock: true };
  }

  status("Confirm with your fingerprint, face or screen lock…");
  const vault = await createVault();
  try {
    const result = await passkeyFlows.signUp({ emailProof, pin, vault, profileBound: false });
    return { opened: result.vault, recoveryCode: result.recoveryCode, passkeyCanUnlock: result.passkeyCanUnlock };
  } catch (err) {
    // A passkey was registered in an earlier attempt but the vault was not:
    // sign in with that passkey, then finish creating the vault.
    if (!(err instanceof AuthApiError && err.code === "reauth_required")) throw err;
    try {
      await passkeyFlows.unlockWithPasskey();
    } catch (loginErr) {
      if (!(loginErr instanceof NoVaultError)) throw loginErr;
    }
    await authApi.createVault({ encryptedSeed: vault.encryptedSeed, profileBound: false });
    await passkeyFlows.setPin(vault.secrets, pin);
    const recoveryCode = await passkeyFlows.setRecoveryCode(vault.secrets);
    return { opened: { secrets: vault.secrets, keys: vault.keys } as OpenedVault, recoveryCode, passkeyCanUnlock: false };
  }
}

/** Runs (or resumes) the upgrade. `opened` is passed when the vault is already unlocked. */
export async function migrateLegacyAccount(input: {
  user: SessionUser;
  pin: string;
  opened?: OpenedVault;
  onStatus?: Status;
}): Promise<MigrationResult> {
  const status = input.onStatus ?? (() => undefined);
  const emailProof = await getEmailProof();
  if (!emailProof) throw new Error("Your Google sign-in expired. Please continue with Google again.");

  const email = input.user.email.toLowerCase().trim();
  const oldKeys = await deriveKeysFromEmailAndPin(email, input.pin);

  let opened = input.opened ?? null;
  let recoveryCode: string | null = null;
  let passkeyCanUnlock = true;
  if (!opened) {
    const result = await openOrCreateVault(input.pin, emailProof, status);
    opened = result.opened;
    recoveryCode = result.recoveryCode;
    passkeyCanUnlock = result.passkeyCanUnlock;
  }
  // Resuming: an earlier attempt may have set a recovery code the user never
  // saw (it stopped before the code was shown), so always issue a fresh one.
  if (!recoveryCode) {
    await ensureFreshSession();
    recoveryCode = await passkeyFlows.setRecoveryCode(opened.secrets);
  }
  const newKeys = opened.keys;

  // Only sweep while the profile still points at the old keys (the note API
  // finds notes through the profile).
  let notesMoved = 0;
  if (input.user.public_encryption_key === oldKeys.viewing.publicKey) {
    status("Moving your private balance…");
    notesMoved = await sweepNotes(oldKeys, newKeys, input.user.username, status);
  }

  status("Switching your account to the new keys…");
  await ensureFreshSession();
  let user: SessionUser = input.user;
  try {
    user = (await authApi.bindProfileKeys({
      publicEncryptionKey: newKeys.viewing.publicKey,
      stellarAddress: newKeys.stellar.publicKey,
      identityCommitment: await identityCommitment(newKeys.spendingKey),
    })).user as SessionUser;
  } catch (err) {
    if (!(err instanceof AuthApiError && err.code === "already_bound")) throw err;
    user = (await authApi.getSession()).user as SessionUser;
  }
  if (user.public_encryption_key !== newKeys.viewing.publicKey) {
    throw new Error("The account switched to different keys than this vault. Please contact support@starlitpay.xyz.");
  }

  let publicXlm: PublicSweepResult = { status: "none" };
  try {
    publicXlm = await sweepPublicXlm(oldKeys, newKeys, status);
  } catch (err) {
    publicXlm = { status: "skipped", reason: err instanceof Error ? err.message : "Could not move public XLM." };
  }

  // Drop the old session (legacy token and plaintext keys in localStorage).
  clearSession();
  unlockFromVault(opened, user);
  return { recoveryCode, passkeyCanUnlock, notesMoved, publicXlm };
}

/** True when an unlocked vault belongs to an account whose upgrade did not finish. */
export function needsMigrationFinish(user: SessionUser, opened: OpenedVault): boolean {
  return !!user.public_encryption_key && user.public_encryption_key !== opened.keys.viewing.publicKey;
}

export function migrationErrorMessage(err: unknown): string {
  if (err instanceof BackendError) return `The upgrade paused: ${err.message}. Your funds are safe; try again to continue.`;
  return err instanceof Error ? err.message : "The upgrade paused. Your funds are safe; try again to continue.";
}
